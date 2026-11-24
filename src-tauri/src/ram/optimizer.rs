use crate::ram::metrics::{
    is_protected_process, normalize_group_key, read_ram_metrics, RamMetrics, RamState,
};
use crate::uac;
use serde::Serialize;
use std::collections::HashSet;
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessesToUpdate};

/// Resultado completo y honesto tras ejecutar la optimización de memoria RAM.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamOptimizeResult {
    pub before: RamMetrics,
    pub after: RamMetrics,
    pub freed_bytes: u64,
    pub standby_freed_bytes: u64,
    pub processes_trimmed: u32,
    pub processes_skipped: u32,
    pub standby_purged: bool,
    pub note: Option<String>,
    pub duration_ms: u64,
}

/// Resultado tras cerrar un grupo de procesos de una aplicación de usuario.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseGroupResult {
    pub group_name: String,
    pub closed_count: u32,
    pub failed_count: u32,
    pub blocked_count: u32,
    pub message: String,
}

/// Cálculo seguro de bytes liberados sin underflow ni pánico si la memoria sube levemente.
pub fn compute_freed_bytes(before_bytes: u64, after_bytes: u64) -> u64 {
    before_bytes.saturating_sub(after_bytes)
}

#[cfg(windows)]
mod win_ram {
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows::core::{PCSTR, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED,
        TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
    };
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows::Win32::System::ProcessStatus::K32EmptyWorkingSet;
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SET_QUOTA,
    };

    /// Guardia RAII para garantizar cierre de `HANDLE` Win32 sin fugas.
    struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.0.is_invalid() {
                let _ = unsafe { CloseHandle(self.0) };
            }
        }
    }

    /// Reduce el Working Set de un proceso de usuario concreto mediante `K32EmptyWorkingSet`.
    pub fn trim_process_working_set(pid: u32) -> bool {
        let access = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA;
        let Ok(raw_handle) = (unsafe { OpenProcess(access, false, pid) }) else {
            return false;
        };
        let handle = OwnedHandle(raw_handle);
        unsafe { K32EmptyWorkingSet(handle.0) }.as_bool()
    }

    /// Habilita `SeProfileSingleProcessPrivilege` e invoca `NtSetSystemInformation`
    /// para purgar la Standby List (`SystemMemoryListInformation = 80`, `MemoryPurgeStandbyList = 4`).
    pub fn purge_standby_list() -> Result<(), String> {
        // 1. Abrir token del proceso actual
        let mut raw_token = HANDLE::default();
        unsafe {
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
                &mut raw_token,
            )
        }
        .map_err(|err| format!("No se pudo abrir el token de privilegios: {err}"))?;
        let token = OwnedHandle(raw_token);

        // 2. Buscar LUID de SeProfileSingleProcessPrivilege
        let mut luid = Default::default();
        let priv_name_wide: Vec<u16> = "SeProfileSingleProcessPrivilege\0".encode_utf16().collect();
        unsafe {
            LookupPrivilegeValueW(
                PCWSTR::null(),
                PCWSTR(priv_name_wide.as_ptr()),
                &mut luid,
            )
        }
        .map_err(|err| {
            format!("No se pudo consultar el privilegio SeProfileSingleProcessPrivilege: {err}")
        })?;

        let tp = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };

        unsafe { AdjustTokenPrivileges(token.0, false, Some(&tp), 0, None, None) }
            .map_err(|err| format!("No se pudo habilitar el privilegio de Standby List: {err}"))?;

        // 3. Cargar dinámicamente NtSetSystemInformation desde ntdll.dll
        let ntdll_wide: Vec<u16> = "ntdll.dll\0".encode_utf16().collect();
        let module = unsafe { GetModuleHandleW(PCWSTR(ntdll_wide.as_ptr())) }
            .map_err(|err| format!("No se pudo cargar ntdll.dll: {err}"))?;

        let proc_addr =
            unsafe { GetProcAddress(module, PCSTR(b"NtSetSystemInformation\0".as_ptr())) }
                .ok_or_else(|| {
                    "No se encontró NtSetSystemInformation en ntdll.dll.".to_string()
                })?;

        type NtSetSystemInformationFn =
            unsafe extern "system" fn(i32, *mut c_void, u32) -> i32;
        let nt_set_system_information: NtSetSystemInformationFn =
            unsafe { std::mem::transmute(proc_addr) };

        const SYSTEM_MEMORY_LIST_INFORMATION: i32 = 80;
        let mut purge_command: u32 = 4; // MemoryPurgeStandbyList

        let status = unsafe {
            nt_set_system_information(
                SYSTEM_MEMORY_LIST_INFORMATION,
                (&mut purge_command as *mut u32).cast::<c_void>(),
                size_of::<u32>() as u32,
            )
        };

        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "Windows devolvió NTSTATUS 0x{:08X} al limpiar la Standby List.",
                status as u32
            ))
        }
    }
}

/// Optimiza la memoria RAM:
/// - Fase 1: `K32EmptyWorkingSet` en procesos de usuario no protegidos ni excluidos.
/// - Fase 2 (opcional): purga de *Standby List* si `purge_standby == true` y hay Modo Administrador.
pub fn optimize_ram(
    purge_standby: bool,
    exclude_group_keys: &[String],
    ram_state: &RamState,
) -> Result<RamOptimizeResult, String> {
    let started_at = Instant::now();
    let before = read_ram_metrics()?;

    let excluded: HashSet<String> = exclude_group_keys
        .iter()
        .map(|s| normalize_group_key(s))
        .collect();

    // Capturar PIDs elegibles reutilizando el System en RamState
    let candidate_pids: Vec<u32> = {
        let mut sys = ram_state
            .system
            .lock()
            .map_err(|_| "No se pudo bloquear el monitor de procesos.".to_string())?;
        sys.refresh_processes(ProcessesToUpdate::All, true);

        sys.processes()
            .iter()
            .filter_map(|(pid, proc_info)| {
                let pid_u32 = pid.as_u32();
                let name = proc_info.name().to_string_lossy();
                if is_protected_process(&name, pid_u32) {
                    return None;
                }
                let gkey = normalize_group_key(&name);
                if excluded.contains(&gkey) {
                    return None;
                }
                Some(pid_u32)
            })
            .collect()
    };

    let mut processes_trimmed = 0u32;
    let mut processes_skipped = 0u32;

    #[cfg(windows)]
    {
        for pid in candidate_pids {
            if win_ram::trim_process_working_set(pid) {
                processes_trimmed += 1;
            } else {
                processes_skipped += 1;
            }
        }
    }

    #[cfg(not(windows))]
    {
        processes_skipped = u32::try_from(candidate_pids.len()).unwrap_or(0);
    }

    // Fase 2: Purga de Standby List
    let mut standby_purged = false;
    let mut note: Option<String> = None;

    if purge_standby {
        if !uac::is_running_as_admin() {
            note = Some(
                "La limpieza de Standby List requiere Modo Administrador; se optimizó únicamente el Working Set de tus aplicaciones."
                    .to_string(),
            );
        } else {
            #[cfg(windows)]
            match win_ram::purge_standby_list() {
                Ok(()) => standby_purged = true,
                Err(err) => {
                    note = Some(format!(
                        "Se optimizaron tus programas, pero no se pudo purgar la Standby List: {err}"
                    ));
                }
            }

            #[cfg(not(windows))]
            {
                note = Some(
                    "La purga de Standby List solo está disponible en Windows.".to_string(),
                );
            }
        }
    }

    // Esperar ~250ms para que el gestor de memoria de Windows actualice los contadores
    thread::sleep(Duration::from_millis(250));
    let after = read_ram_metrics()?;

    let freed_bytes = compute_freed_bytes(before.used_bytes, after.used_bytes);
    let standby_freed_bytes =
        compute_freed_bytes(before.cached_standby_bytes, after.cached_standby_bytes);

    Ok(RamOptimizeResult {
        before,
        after,
        freed_bytes,
        standby_freed_bytes,
        processes_trimmed,
        processes_skipped,
        standby_purged,
        note,
        duration_ms: u64::try_from(started_at.elapsed().as_millis()).unwrap_or(0),
    })
}

/// Cierra un grupo de procesos de usuario validando estrictamente que ningún PID sea crítico ni DiskVault Clean.
pub fn close_process_group(
    pids: &[u32],
    group_name: &str,
    ram_state: &RamState,
) -> Result<CloseGroupResult, String> {
    if pids.is_empty() {
        return Err("No se recibieron procesos válidos para cerrar.".to_string());
    }

    let mut sys = ram_state
        .system
        .lock()
        .map_err(|_| "No se pudo bloquear el monitor de procesos.".to_string())?;
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut closed_count = 0u32;
    let mut failed_count = 0u32;
    let mut blocked_count = 0u32;

    for &pid_u32 in pids {
        if let Some(proc_info) = sys.process(Pid::from_u32(pid_u32)) {
            let pname = proc_info.name().to_string_lossy();
            if is_protected_process(&pname, pid_u32) {
                blocked_count += 1;
                continue;
            }
            if proc_info.kill() {
                closed_count += 1;
            } else {
                failed_count += 1;
            }
        }
    }

    if blocked_count > 0 && closed_count == 0 {
        return Err(
            "Operación bloqueada por seguridad: no se permite cerrar procesos críticos del sistema o DiskVault Clean."
                .to_string(),
        );
    }

    let message = if closed_count > 0 && failed_count == 0 {
        format!("Se cerró '{group_name}' ({closed_count} proceso(s)).")
    } else if closed_count > 0 {
        format!(
            "Se cerraron {closed_count} proceso(s) de '{group_name}' ({failed_count} requirieron permisos elevados)."
        )
    } else {
        format!(
            "No se pudo cerrar '{group_name}'. Puede haberse cerrado ya o requerir Modo Administrador."
        )
    };

    Ok(CloseGroupResult {
        group_name: group_name.to_string(),
        closed_count,
        failed_count,
        blocked_count,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::compute_freed_bytes;

    /// Prueba obligatoria 3: Cálculo seguro sin underflow ni pánico cuando `after > before`.
    #[test]
    fn calculo_de_memoria_liberada_no_produce_underflow() {
        assert_eq!(compute_freed_bytes(8_000_000_000, 6_500_000_000), 1_500_000_000);
        // Si Windows asignó más RAM justo entre ambas lecturas, debe retornar 0 limpiamente
        assert_eq!(compute_freed_bytes(6_500_000_000, 6_800_000_000), 0);
        assert_eq!(compute_freed_bytes(0, 1024), 0);
    }
}
