use crate::apps::inventory::{is_safe_specific_install_path, AppsState, InstalledApp};
use crate::apps::uninstaller::{
    close_app_processes, find_running_processes_in_dir, RunningProcessInfo,
};
use crate::mover::pipeline::{
    execute_safe_transfer, resolve_final_destination, MoverState, TransferMode, TransferRequest,
    TransferResult,
};
use crate::mover::targets::{is_network_destination, query_destination_space};
use crate::scanner::engine::ScanState;
use crate::security;
use crate::storage::db::Database;
use crate::uac;
use jwalk::WalkDir;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use sysinfo::Disks;
use tauri::AppHandle;

/// Margen mínimo de seguridad en el disco destino (100 MiB).
const RELOCATE_SAFETY_MARGIN_BYTES: u64 = 100 * 1024 * 1024;

/// Diagnóstico previo antes de reubicar una aplicación/juego a otro disco local NTFS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocatePreflight {
    pub app_id: String,
    pub app_name: String,
    pub source_path: String,
    pub resolved_dest_path: String,
    pub size_bytes: u64,
    pub required_bytes: u64,
    pub dest_free_bytes: u64,
    pub fits_in_destination: bool,
    pub dest_already_exists: bool,
    pub requires_admin: bool,
    pub is_admin: bool,
    pub running_processes: Vec<RunningProcessInfo>,
}

/// Comprueba si una ruta de instalación reside en directorios que exigen elevación UAC.
pub fn install_location_requires_admin(install_path: &Path) -> bool {
    let norm = install_path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    norm.contains(r":\program files\")
        || norm.contains(r":\program files (x86)\")
        || norm.contains(r":\programdata\")
}

/// Valida que el destino de reubicación de una app sea una ruta local válida y NO una ruta de red/NAS ni protegida.
pub fn validate_relocate_paths(source: &Path, dest_parent: &Path) -> Result<(), String> {
    security::ensure_path_is_not_protected(source)?;

    if !is_safe_specific_install_path(source) {
        return Err(
            "La carpeta de instalación de esta aplicación es compartida o protegida y no es seguro reubicarla."
                .to_string(),
        );
    }

    let dest_str = dest_parent.to_string_lossy();
    if dest_str.trim().is_empty() {
        return Err("Selecciona una carpeta de destino en otro disco local.".to_string());
    }

    if is_network_destination(&dest_str) {
        return Err(
            "Las aplicaciones instaladas deben reubicarse en un disco local NTFS (ej. D:\\Apps o E:\\Juegos), no en una carpeta de red NAS. Para respaldar carpetas al NAS utiliza la sección 'Mover al NAS'."
                .to_string(),
        );
    }

    if security::is_protected_path(dest_parent) {
        return Err(
            "No puedes elegir una carpeta protegida del sistema Windows como destino.".to_string(),
        );
    }

    // Evita mover una app a la misma carpeta o dentro de sí misma
    let src_norm = source
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    let dst_norm = dest_str.trim().replace('/', "\\").to_ascii_lowercase();
    if dst_norm == src_norm || dst_norm.starts_with(&format!("{src_norm}\\")) {
        return Err(
            "La carpeta de destino no puede estar dentro de la carpeta actual de la aplicación."
                .to_string(),
        );
    }

    Ok(())
}

/// Comprueba si la unidad local de destino usa sistema de archivos NTFS (en Windows).
fn is_destination_ntfs_if_known(dest_parent: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let dest_lower = dest_parent
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase();
        let disks = Disks::new_with_refreshed_list();
        for disk in disks.list() {
            let mount = disk
                .mount_point()
                .to_string_lossy()
                .replace('/', "\\")
                .to_ascii_lowercase();
            if !mount.is_empty() && dest_lower.starts_with(&mount) {
                let fs_name = disk.file_system().to_string_lossy().to_ascii_uppercase();
                if !fs_name.is_empty() && fs_name != "NTFS" {
                    return Err(format!(
                        "La unidad de destino usa sistema de archivos '{fs_name}'. Para reubicar aplicaciones con enlaces transparentes se requiere un disco local formateado en NTFS."
                    ));
                }
                break;
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (dest_parent, Disks::new);
    }
    Ok(())
}

fn compute_folder_size_accurate(path: &Path) -> u64 {
    let mut total = 0u64;
    for entry in WalkDir::new(path).follow_links(false).skip_hidden(false) {
        if let Ok(item) = entry {
            if item.file_type().is_file() {
                if let Ok(meta) = item.metadata() {
                    total = total.saturating_add(meta.len());
                }
            }
        }
    }
    total
}

fn lookup_relocatable_app(app_id: &str, apps_state: &AppsState) -> Result<InstalledApp, String> {
    let guard = apps_state
        .apps
        .read()
        .map_err(|_| "No se pudo leer el inventario de aplicaciones.".to_string())?;
    let app = guard
        .get(app_id)
        .cloned()
        .ok_or_else(|| "No se encontró la aplicación seleccionada.".to_string())?;

    if app.app_type != "win32" {
        return Err(
            "Las aplicaciones de Microsoft Store no pueden reubicarse manualmente porque residen en WindowsApps."
                .to_string(),
        );
    }
    if app.is_relocated {
        return Err("Esta aplicación ya fue reubicada previamente a otro disco.".to_string());
    }
    Ok(app)
}

/// Diagnóstico completo previo a reubicar una aplicación/juego a otro disco local NTFS.
pub fn preflight_relocate_app(
    app_id: &str,
    dest_parent_dir: &str,
    apps_state: &AppsState,
) -> Result<RelocatePreflight, String> {
    let app = lookup_relocatable_app(app_id, apps_state)?;
    let source_str = app.install_location.as_deref().ok_or_else(|| {
        "Esta aplicación no tiene una carpeta de instalación válida para mover.".to_string()
    })?;

    let source = Path::new(source_str);
    let dest_parent = Path::new(dest_parent_dir.trim());

    validate_relocate_paths(source, dest_parent)?;

    if !source.exists() || !source.is_dir() {
        return Err(format!(
            "La carpeta de la aplicación ya no existe en '{}'.",
            source.display()
        ));
    }
    if !dest_parent.exists() || !dest_parent.is_dir() {
        return Err(format!(
            "La carpeta de destino '{}' no existe o no es accesible.",
            dest_parent.display()
        ));
    }

    is_destination_ntfs_if_known(dest_parent)?;

    let (_, resolved_dest) = resolve_final_destination(source, dest_parent)?;

    let size_bytes = app
        .real_size_bytes
        .unwrap_or_else(|| compute_folder_size_accurate(source));
    let required_bytes = size_bytes.saturating_add(RELOCATE_SAFETY_MARGIN_BYTES);
    let (dest_free_bytes, _) = query_destination_space(dest_parent).unwrap_or((0, 0));

    let fits_in_destination = dest_free_bytes >= required_bytes;
    let running_processes = find_running_processes_in_dir(&[source_str]);
    let requires_admin = install_location_requires_admin(source);
    let is_admin = uac::is_running_as_admin();

    Ok(RelocatePreflight {
        app_id: app.id,
        app_name: app.name,
        source_path: source_str.to_string(),
        resolved_dest_path: resolved_dest.to_string_lossy().to_string(),
        size_bytes,
        required_bytes,
        dest_free_bytes,
        fits_in_destination,
        dest_already_exists: resolved_dest.exists(),
        requires_admin,
        is_admin,
        running_processes,
    })
}

/// Ejecuta la reubicación segura de una aplicación reutilizando el motor en 3 fases del Paso 3
/// (`TransferMode::MoveSymlink` -> Directory Junction NTFS + verificación 100% xxHash3).
pub async fn execute_relocate_app(
    app_handle: AppHandle,
    app_id: String,
    dest_parent_dir: String,
    close_running_first: bool,
    apps_state: &AppsState,
    mover_state: &MoverState,
    scan_state: &ScanState,
    db: &Database,
) -> Result<TransferResult, String> {
    let preflight = preflight_relocate_app(&app_id, &dest_parent_dir, apps_state)?;

    if preflight.requires_admin && !preflight.is_admin {
        return Err(
            "NEEDS_ADMIN: Esta aplicación está en Program Files / ProgramData y requiere activar el Modo Administrador antes de reubicarla."
                .to_string(),
        );
    }

    if preflight.dest_already_exists {
        return Err(format!(
            "Ya existe una carpeta en '{}'. Elige otra carpeta destino para evitar conflictos.",
            preflight.resolved_dest_path
        ));
    }

    if !preflight.fits_in_destination {
        return Err(
            "No hay espacio suficiente en el disco destino (se requiere el tamaño de la app más 100 MB de margen)."
                .to_string(),
        );
    }

    // Si hay procesos abiertos de la app, cerrarlos primero o pedir confirmación al usuario
    if !preflight.running_processes.is_empty() {
        if close_running_first {
            let pids: Vec<u32> = preflight.running_processes.iter().map(|p| p.pid).collect();
            let _ = close_app_processes(&pids)?;
            thread::sleep(Duration::from_millis(1000));
        } else {
            return Err(format!(
                "'{}' está abierta actualmente ({} proceso(s)). Ciérrala o marca 'Cerrar automáticamente antes de mover'.",
                preflight.app_name,
                preflight.running_processes.len()
            ));
        }
    }

    if mover_state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "Ya hay otra transferencia o reubicación en curso. Espera a que termine antes de continuar."
                .to_string(),
        );
    }

    mover_state.pause_flag.store(false, Ordering::SeqCst);
    mover_state.cancel_flag.store(false, Ordering::SeqCst);

    let pause_flag = mover_state.pause_flag.clone();
    let cancel_flag = mover_state.cancel_flag.clone();
    let is_running = mover_state.is_running.clone();

    let request = TransferRequest {
        source_path: preflight.source_path.clone(),
        dest_root: dest_parent_dir.trim().to_string(),
        mode: TransferMode::MoveSymlink,
        send_local_to_trash: false,
        skip_verification: false,
    };

    let req_clone = request.clone();
    let exec_res = tokio::task::spawn_blocking(move || {
        execute_safe_transfer(&req_clone, pause_flag, cancel_flag, Some(app_handle))
    })
    .await
    .map_err(|err| format!("Error interno al ejecutar el reubicador: {err}"));

    is_running.store(false, Ordering::SeqCst);
    mover_state.pause_flag.store(false, Ordering::SeqCst);

    match exec_res? {
        Ok(res) => {
            let _ = db.record_transfer_history(
                &res.source_path,
                &res.dest_path,
                res.mode.as_db_str(),
                res.files_count,
                res.total_bytes,
                &res.status,
                None,
                res.duration_ms,
            );

            let _ = db.record_audit_log(
                "apps",
                "relocate_app",
                Some(&res.source_path),
                Some(&res.dest_path),
                i64::try_from(res.total_bytes).unwrap_or(i64::MAX),
                "ok",
                Some(&format!(
                    "Aplicación '{}' reubicada a '{}' mediante enlace NTFS verificado con xxHash3.",
                    preflight.app_name, res.dest_path
                )),
            );

            // Actualiza el estado de la app en memoria como ya reubicada
            if let Ok(mut guard) = apps_state.apps.write() {
                if let Some(app_entry) = guard.get_mut(&app_id) {
                    app_entry.is_relocated = true;
                    app_entry.relocated_target = Some(res.dest_path.clone());
                    app_entry.can_relocate = false;
                    app_entry.relocate_disabled_reason = Some(
                        "Esta aplicación ya fue reubicada a otro disco mediante un enlace NTFS."
                            .to_string(),
                    );
                }
            }

            // Descuenta el espacio en el índice de escaneo en memoria si existía
            if let Ok(mut guard) = scan_state.index.write() {
                if let Some(index) = guard.as_mut() {
                    index.remove_deleted_path(Path::new(&res.source_path), res.total_bytes);
                }
            }

            Ok(res)
        }
        Err((status, error_msg, files_count, total_bytes, duration_ms)) => {
            let _ = db.record_transfer_history(
                &preflight.source_path,
                dest_parent_dir.trim(),
                TransferMode::MoveSymlink.as_db_str(),
                files_count,
                total_bytes,
                &status,
                Some(&error_msg),
                duration_ms,
            );

            let _ = db.record_audit_log(
                "apps",
                "relocate_app_aborted",
                Some(&preflight.source_path),
                Some(dest_parent_dir.trim()),
                0,
                "warning",
                Some(&error_msg),
            );

            Err(error_msg)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_relocate_paths;
    use std::path::Path;

    #[test]
    fn preflight_reubicacion_bloquea_rutas_unc_nas_y_carpetas_protegidas() {
        // Bloquea destino de red UNC/NAS
        let unc_err = validate_relocate_paths(
            Path::new(r"C:\Program Files\MiJuego"),
            Path::new(r"\\192.168.1.50\Respaldos\Apps"),
        );
        assert!(unc_err.is_err());
        assert!(unc_err.unwrap_err().contains("Mover al NAS"));

        // Bloquea origen protegido del SO
        let protected_src = validate_relocate_paths(
            Path::new(r"C:\Windows\System32"),
            Path::new(r"D:\Apps"),
        );
        assert!(protected_src.is_err());

        // Bloquea origen genérico
        let generic_src = validate_relocate_paths(
            Path::new(r"C:\Program Files"),
            Path::new(r"D:\Apps"),
        );
        assert!(generic_src.is_err());

        // Bloquea destino protegido
        let protected_dst = validate_relocate_paths(
            Path::new(r"C:\Program Files\MiJuego"),
            Path::new(r"C:\Windows"),
        );
        assert!(protected_dst.is_err());

        // Permite origen específico de app hacia carpeta en otro disco local
        let valid = validate_relocate_paths(
            Path::new(r"C:\Program Files\MiJuego"),
            Path::new(r"D:\Apps"),
        );
        assert!(valid.is_ok());
    }
}
