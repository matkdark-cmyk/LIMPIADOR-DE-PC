use crate::uac;
use chrono::Utc;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::{ProcessesToUpdate, System};

/// Métricas reales de memoria física, caché/Standby y memoria comprometida de Windows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamMetrics {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: f32,
    pub cached_standby_bytes: u64,
    pub commit_used_bytes: u64,
    pub commit_limit_bytes: u64,
}

/// Subproceso individual perteneciente a una aplicación agrupada.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildProcessInfo {
    pub pid: u32,
    pub name: String,
    pub memory_bytes: u64,
}

/// Aplicación agrupada con la suma de memoria de todos sus subprocesos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupedAppProcess {
    pub group_key: String,
    pub display_name: String,
    pub exe_path: Option<String>,
    pub total_memory_bytes: u64,
    pub percent_of_ram: f32,
    pub process_count: usize,
    pub is_system_critical: bool,
    pub is_self: bool,
    pub children: Vec<ChildProcessInfo>,
}

/// Fotografía completa de RAM + procesos agrupados enviada al frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamSnapshot {
    pub metrics: RamMetrics,
    pub processes: Vec<GroupedAppProcess>,
    pub is_admin: bool,
    pub timestamp: String,
}

/// Instancia única reutilizable de `sysinfo::System` gestionada por Tauri para evitar
/// overhead de recrear `System::new_all()` en cada lectura.
pub struct RamState {
    pub system: Mutex<System>,
}

impl Default for RamState {
    fn default() -> Self {
        Self {
            system: Mutex::new(System::new()),
        }
    }
}

/// Procesos críticos de Windows que NUNCA deben recortarse ni cerrarse.
const PROTECTED_PROCESS_NAMES: &[&str] = &[
    "system",
    "registry",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "svchost.exe",
    "dwm.exe",
    "explorer.exe",
    "memory compression",
    "msmpeng.exe",
    "securityhealthservice.exe",
    "fontdrvhost.exe",
    "audiodg.exe",
    "ntoskrnl.exe",
    "wudfhost.exe",
    "searchindexer.exe",
    "sihost.exe",
    "ctfmon.exe",
    "runtimebroker.exe",
    "diskvault-clean.exe",
];

/// Comprueba si un proceso es crítico del sistema Windows o corresponde a DiskVault Clean.
pub fn is_protected_process(name: &str, pid: u32) -> bool {
    if pid == 0 || pid == 4 || pid == std::process::id() {
        return true;
    }
    let normalized = name.trim().to_ascii_lowercase();
    PROTECTED_PROCESS_NAMES.contains(&normalized.as_str())
}

/// Normaliza la clave de agrupación para consolidar ayudantes conocidos bajo su aplicación principal.
pub fn normalize_group_key(raw_name: &str) -> String {
    let lower = raw_name.trim().to_ascii_lowercase();
    match lower.as_str() {
        "steamwebhelper.exe" | "steamservice.exe" => "steam.exe".to_string(),
        "ms-teams.exe" | "ms-teamsupdate.exe" | "msteams.exe" => "teams.exe".to_string(),
        "msedgewebview2.exe" => "msedgewebview2.exe".to_string(),
        _ => lower,
    }
}

/// Diccionario de nombres amigables en español/comerciales para ejecutables frecuentes.
pub fn friendly_display_name(group_key: &str) -> String {
    match group_key {
        "chrome.exe" => "Google Chrome".to_string(),
        "msedge.exe" => "Microsoft Edge".to_string(),
        "msedgewebview2.exe" => "WebView2 (Componentes Web)".to_string(),
        "firefox.exe" => "Mozilla Firefox".to_string(),
        "brave.exe" => "Brave Browser".to_string(),
        "opera.exe" => "Opera".to_string(),
        "vivaldi.exe" => "Vivaldi".to_string(),
        "code.exe" => "Visual Studio Code".to_string(),
        "discord.exe" => "Discord".to_string(),
        "spotify.exe" => "Spotify".to_string(),
        "steam.exe" => "Steam".to_string(),
        "teams.exe" => "Microsoft Teams".to_string(),
        "slack.exe" => "Slack".to_string(),
        "zoom.exe" => "Zoom".to_string(),
        "notepad.exe" => "Bloc de notas".to_string(),
        "winword.exe" => "Microsoft Word".to_string(),
        "excel.exe" => "Microsoft Excel".to_string(),
        "powerpnt.exe" => "Microsoft PowerPoint".to_string(),
        "outlook.exe" => "Microsoft Outlook".to_string(),
        "photoshop.exe" => "Adobe Photoshop".to_string(),
        "adobe premiere pro.exe" => "Adobe Premiere Pro".to_string(),
        "afterfx.exe" => "Adobe After Effects".to_string(),
        "obs64.exe" => "OBS Studio".to_string(),
        "whatsapp.exe" => "WhatsApp".to_string(),
        "telegram.exe" => "Telegram".to_string(),
        "epicgameslauncher.exe" => "Epic Games Launcher".to_string(),
        "explorer.exe" => "Explorador de Windows".to_string(),
        "dwm.exe" => "Administrador de ventanas (DWM)".to_string(),
        "msmpeng.exe" => "Windows Defender".to_string(),
        "svchost.exe" => "Servicios de Windows (svchost)".to_string(),
        "memory compression" => "Compresión de memoria de Windows".to_string(),
        "system" => "Sistema (Kernel Windows)".to_string(),
        "diskvault-clean.exe" => "DiskVault Clean".to_string(),
        other => {
            let base = other.strip_suffix(".exe").unwrap_or(other);
            let mut chars = base.chars();
            match chars.next() {
                None => other.to_string(),
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
            }
        }
    }
}

/// Lectura directa y veloz de métricas de memoria vía Win32 (`GlobalMemoryStatusEx` + `K32GetPerformanceInfo`).
#[cfg(windows)]
pub fn read_ram_metrics() -> Result<RamMetrics, String> {
    use windows::Win32::System::ProcessStatus::{K32GetPerformanceInfo, PERFORMANCE_INFORMATION};
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut mem = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };

    unsafe { GlobalMemoryStatusEx(&mut mem) }
        .map_err(|err| format!("No se pudo leer el estado de memoria de Windows: {err}"))?;

    let total_bytes = mem.ullTotalPhys;
    let available_bytes = mem.ullAvailPhys.min(total_bytes);
    let used_bytes = total_bytes.saturating_sub(available_bytes);
    let usage_percent = if total_bytes > 0 {
        ((used_bytes as f64 / total_bytes as f64) * 100.0) as f32
    } else {
        0.0
    };

    let mut perf = PERFORMANCE_INFORMATION {
        cb: std::mem::size_of::<PERFORMANCE_INFORMATION>() as u32,
        ..Default::default()
    };
    let perf_ok = unsafe { K32GetPerformanceInfo(&mut perf, perf.cb) }.as_bool();

    let (cached_standby_bytes, commit_used_bytes, commit_limit_bytes) = if perf_ok {
        let page_size = perf.PageSize as u64;
        let system_cache = (perf.SystemCache as u64).saturating_mul(page_size);
        let commit_used = (perf.CommitTotal as u64).saturating_mul(page_size);
        let commit_limit = (perf.CommitLimit as u64).saturating_mul(page_size);
        (system_cache.min(available_bytes), commit_used, commit_limit)
    } else {
        let commit_limit = mem.ullTotalPageFile;
        let commit_used = commit_limit.saturating_sub(mem.ullAvailPageFile);
        (0, commit_used, commit_limit)
    };

    Ok(RamMetrics {
        total_bytes,
        used_bytes,
        available_bytes,
        usage_percent,
        cached_standby_bytes,
        commit_used_bytes,
        commit_limit_bytes,
    })
}

/// Fallback portable para compilación y pruebas en entornos no-Windows.
#[cfg(not(windows))]
pub fn read_ram_metrics() -> Result<RamMetrics, String> {
    let mut sys = System::new();
    sys.refresh_memory();
    let total_bytes = sys.total_memory();
    let available_bytes = sys.available_memory().min(total_bytes);
    let used_bytes = total_bytes.saturating_sub(available_bytes);
    let usage_percent = if total_bytes > 0 {
        ((used_bytes as f64 / total_bytes as f64) * 100.0) as f32
    } else {
        0.0
    };
    let free_bytes = sys.free_memory().min(available_bytes);
    let cached_standby_bytes = available_bytes.saturating_sub(free_bytes);

    Ok(RamMetrics {
        total_bytes,
        used_bytes,
        available_bytes,
        usage_percent,
        cached_standby_bytes,
        commit_used_bytes: used_bytes.saturating_add(sys.used_swap()),
        commit_limit_bytes: total_bytes.saturating_add(sys.total_swap()),
    })
}

/// Entrada cruda de proceso usada para agrupar de forma pura y testeable.
#[derive(Debug, Clone)]
pub struct RawProcessEntry {
    pub pid: u32,
    pub name: String,
    pub exe_path: Option<String>,
    pub memory_bytes: u64,
}

/// Agrupa procesos por aplicación normalizada, suma su consumo y ordena estrictamente de mayor a menor.
pub fn group_processes_from_raw(
    raw: Vec<RawProcessEntry>,
    total_ram_bytes: u64,
    self_pid: u32,
) -> Vec<GroupedAppProcess> {
    struct Acc {
        display_name: String,
        exe_path: Option<String>,
        total_memory_bytes: u64,
        is_system_critical: bool,
        is_self: bool,
        children: Vec<ChildProcessInfo>,
    }

    let mut groups: HashMap<String, Acc> = HashMap::new();

    for entry in raw {
        let group_key = normalize_group_key(&entry.name);
        if group_key.is_empty() {
            continue;
        }
        let is_self = entry.pid == self_pid || group_key == "diskvault-clean.exe";
        let is_critical = !is_self && is_protected_process(&entry.name, entry.pid);

        let acc = groups.entry(group_key.clone()).or_insert_with(|| Acc {
            display_name: friendly_display_name(&group_key),
            exe_path: entry.exe_path.clone(),
            total_memory_bytes: 0,
            is_system_critical: is_critical,
            is_self,
            children: Vec::new(),
        });

        if acc.exe_path.is_none() && entry.exe_path.is_some() {
            acc.exe_path = entry.exe_path;
        }
        acc.total_memory_bytes = acc.total_memory_bytes.saturating_add(entry.memory_bytes);
        acc.is_system_critical = acc.is_system_critical || is_critical;
        acc.is_self = acc.is_self || is_self;
        acc.children.push(ChildProcessInfo {
            pid: entry.pid,
            name: entry.name,
            memory_bytes: entry.memory_bytes,
        });
    }

    let mut result: Vec<GroupedAppProcess> = groups
        .into_iter()
        .map(|(group_key, mut acc)| {
            acc.children
                .sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));
            let percent_of_ram = if total_ram_bytes > 0 {
                ((acc.total_memory_bytes as f64 / total_ram_bytes as f64) * 100.0) as f32
            } else {
                0.0
            };
            GroupedAppProcess {
                group_key,
                display_name: acc.display_name,
                exe_path: acc.exe_path,
                total_memory_bytes: acc.total_memory_bytes,
                percent_of_ram,
                process_count: acc.children.len(),
                is_system_critical: acc.is_system_critical,
                is_self: acc.is_self,
                children: acc.children,
            }
        })
        .collect();

    result.sort_by(|a, b| {
        b.total_memory_bytes
            .cmp(&a.total_memory_bytes)
            .then_with(|| a.display_name.cmp(&b.display_name))
    });

    result
}

/// Recolecta métricas reales de RAM + lista agrupada de procesos reutilizando el `System` en `RamState`.
pub fn collect_ram_snapshot(ram_state: &RamState) -> Result<RamSnapshot, String> {
    let metrics = read_ram_metrics()?;
    let self_pid = std::process::id();

    let raw_entries: Vec<RawProcessEntry> = {
        let mut sys = ram_state
            .system
            .lock()
            .map_err(|_| "No se pudo bloquear el monitor de procesos en memoria.".to_string())?;
        sys.refresh_processes(ProcessesToUpdate::All, true);

        sys.processes()
            .iter()
            .map(|(pid, proc_info)| RawProcessEntry {
                pid: pid.as_u32(),
                name: proc_info.name().to_string_lossy().to_string(),
                exe_path: proc_info.exe().map(|p| p.to_string_lossy().to_string()),
                memory_bytes: proc_info.memory(),
            })
            .collect()
    };

    let processes = group_processes_from_raw(raw_entries, metrics.total_bytes, self_pid);

    Ok(RamSnapshot {
        metrics,
        processes,
        is_admin: uac::is_running_as_admin(),
        timestamp: Utc::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::{group_processes_from_raw, is_protected_process, RawProcessEntry};

    /// Prueba obligatoria 1: Protección de procesos críticos y PID actual.
    #[test]
    fn protege_procesos_criticos_del_sistema_y_permite_apps_de_usuario() {
        let critical_names = [
            "System",
            "lsass.exe",
            "dwm.exe",
            "explorer.exe",
            "csrss.exe",
            "svchost.exe",
            "Memory Compression",
        ];
        for name in critical_names {
            assert!(
                is_protected_process(name, 9999),
                "Se esperaba que '{name}' estuviera protegido"
            );
        }

        assert!(is_protected_process("anything.exe", 0));
        assert!(is_protected_process("anything.exe", 4));
        assert!(is_protected_process("diskvault-clean.exe", std::process::id()));
        assert!(is_protected_process("app_actual.exe", std::process::id()));

        assert!(!is_protected_process("chrome.exe", 12345));
        assert!(!is_protected_process("notepad.exe", 23456));
    }

    /// Prueba obligatoria 2: Agrupación, suma de memoria, nombres amigables y orden mayor a menor.
    #[test]
    fn agrupa_procesos_suma_memoria_y_ordena_de_mayor_a_menor() {
        let simulated = vec![
            RawProcessEntry {
                pid: 101,
                name: "chrome.exe".to_string(),
                exe_path: Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string()),
                memory_bytes: 300_000_000,
            },
            RawProcessEntry {
                pid: 102,
                name: "chrome.exe".to_string(),
                exe_path: None,
                memory_bytes: 500_000_000,
            },
            RawProcessEntry {
                pid: 103,
                name: "CHROME.EXE".to_string(),
                exe_path: None,
                memory_bytes: 200_000_000,
            },
            RawProcessEntry {
                pid: 201,
                name: "Code.exe".to_string(),
                exe_path: None,
                memory_bytes: 900_000_000,
            },
            RawProcessEntry {
                pid: 202,
                name: "Code.exe".to_string(),
                exe_path: None,
                memory_bytes: 400_000_000,
            },
            RawProcessEntry {
                pid: 301,
                name: "spotify.exe".to_string(),
                exe_path: None,
                memory_bytes: 250_000_000,
            },
        ];

        let grouped = group_processes_from_raw(simulated, 16_000_000_000, 999_999);
        assert_eq!(grouped.len(), 3);

        // 1º: Visual Studio Code (1.3 GB)
        assert_eq!(grouped[0].display_name, "Visual Studio Code");
        assert_eq!(grouped[0].total_memory_bytes, 1_300_000_000);
        assert_eq!(grouped[0].process_count, 2);
        assert_eq!(grouped[0].children[0].memory_bytes, 900_000_000);

        // 2º: Google Chrome (1.0 GB)
        assert_eq!(grouped[1].display_name, "Google Chrome");
        assert_eq!(grouped[1].total_memory_bytes, 1_000_000_000);
        assert_eq!(grouped[1].process_count, 3);
        assert_eq!(grouped[1].children[0].memory_bytes, 500_000_000);

        // 3º: Spotify (250 MB)
        assert_eq!(grouped[2].display_name, "Spotify");
        assert_eq!(grouped[2].total_memory_bytes, 250_000_000);
        assert_eq!(grouped[2].process_count, 1);
    }
}
