#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::process::Command;
#[cfg(windows)]
use std::thread;
#[cfg(windows)]
use std::time::{Duration, Instant};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Guardia RAII que pausa el servicio `wuauserv` (Windows Update) antes de limpiar
/// `C:\Windows\SoftwareDistribution\Download` y garantiza SIEMPRE su restauración al salir
/// del bloque (`Drop`), incluso si ocurre un error o cancelación.
pub struct WindowsUpdateServiceGuard {
    was_running: bool,
    restarted: bool,
}

impl WindowsUpdateServiceGuard {
    /// Consulta si `wuauserv` está activo y, de estarlo, ejecuta `sc stop wuauserv`
    /// esperando hasta 10 segundos a que alcance el estado `STOPPED`.
    pub fn pause_if_running() -> Self {
        #[cfg(windows)]
        {
            let running = query_service_state("wuauserv")
                .map(|state| state.contains("RUNNING"))
                .unwrap_or(false);

            if !running {
                return Self {
                    was_running: false,
                    restarted: false,
                };
            }

            let _ = Command::new("sc.exe")
                .args(["stop", "wuauserv"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();

            // Esperar hasta 10 segundos a que pase a estado STOPPED
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if let Some(state) = query_service_state("wuauserv") {
                    if state.contains("STOPPED") {
                        break;
                    }
                }
                thread::sleep(Duration::from_millis(300));
            }

            return Self {
                was_running: true,
                restarted: false,
            };
        }

        #[cfg(not(windows))]
        {
            Self {
                was_running: false,
                restarted: false,
            }
        }
    }

    /// Restaura `wuauserv` de forma explícita si originalmente estaba corriendo.
    pub fn restore_now(&mut self) -> bool {
        if !self.was_running || self.restarted {
            return false;
        }

        #[cfg(windows)]
        {
            let started = Command::new("sc.exe")
                .args(["start", "wuauserv"])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            self.restarted = true;
            self.was_running = false;
            return started;
        }

        #[cfg(not(windows))]
        {
            self.restarted = true;
            self.was_running = false;
            false
        }
    }
}

impl Drop for WindowsUpdateServiceGuard {
    fn drop(&mut self) {
        let _ = self.restore_now();
    }
}

#[cfg(windows)]
fn query_service_state(service_name: &str) -> Option<String> {
    let output = Command::new("sc.exe")
        .args(["query", service_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    Some(String::from_utf8_lossy(&output.stdout).to_ascii_uppercase())
}
