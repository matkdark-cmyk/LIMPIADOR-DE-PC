pub mod apps;
pub mod cleaner;
pub mod mover;
pub mod ram;
pub mod scanner;
pub mod security;
pub mod storage;
pub mod theme;
pub mod uac;
pub mod updater;
pub mod watcher;

use apps::inventory::{list_and_enrich_apps, AppsState, InstalledApp};
use apps::relocator::{
    execute_relocate_app as run_relocate_app, preflight_relocate_app as check_relocate_app,
    RelocatePreflight,
};
use apps::uninstaller::{
    check_app_running_processes as find_app_processes, clean_app_leftovers as run_clean_leftovers,
    close_app_processes as kill_app_processes, run_uninstaller_process,
    scan_app_leftovers as find_app_leftovers, LeftoverCleanRequest, LeftoverCleanResult,
    LeftoverItem, RunningProcessInfo, UninstallExecutionResult,
};
use cleaner::engine::{
    close_cleaner_blocking_apps as kill_cleaner_apps, execute_cache_clean as run_cache_clean,
    scan_cache_targets as run_cache_scan, CacheCleanResult, CacheScanReport, CleanerState,
};
use mover::pipeline::{
    execute_safe_transfer, finalize_transfer_without_verification, preflight_transfer, MoverState,
    TransferPreflight, TransferRequest, TransferResult,
};
use mover::targets::{is_network_destination, test_nas_connection as run_nas_test, NasConnectionStatus};
use mover::threat_scan::{scan_source_for_threats, ThreatScanReport};
use ram::auto_monitor::{
    load_auto_config_from_db, save_auto_config_to_db, spawn_ram_auto_monitor, RamAutoConfig,
    RamAutoState,
};
use ram::metrics::{collect_ram_snapshot, RamSnapshot, RamState};
use ram::optimizer::{
    close_process_group as kill_process_group, optimize_ram as run_optimize_ram, CloseGroupResult,
    RamOptimizeResult,
};
use scanner::categories::FileSection;
use scanner::engine::{
    execute_disk_scan, sanitize_scan_root, FileNode, ScanState, ScanSummary,
};
use scanner::overview::{collect_system_overview, SystemOverview};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use storage::db::{AuditLogEntry, Database, NasTarget, TransferHistoryEntry};
use storage::paths::{resolve_app_paths, AppPaths};
use storage::settings::{
    export_audit_logs_to_file, load_settings_from_db, save_settings_to_db, sync_windows_autostart,
    AppSettings,
};
use tauri::{AppHandle, Manager, State};
use theme::{read_windows_theme_info, resolve_tauri_window_theme, WindowsThemeInfo};
use updater::{
    check_github_updates, download_and_apply_update, InstallUpdateRequest, UpdateCheckResult,
};
use watcher::{
    spawn_incoming_file_watcher, trigger_test_incoming_notification, IncomingFileEvent,
    WatchedFoldersInfo, WatcherState,
};

/// Estado compartido administrado por Tauri durante toda la sesión.
pub struct AppState {
    pub paths: AppPaths,
    pub db: Database,
    pub initial_route: String,
    pub is_admin: bool,
}

/// Diagnóstico y configuración inicial enviados al frontend en `get_app_status`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub is_admin: bool,
    pub is_portable: bool,
    pub data_dir: String,
    pub logs_dir: String,
    pub db_path: String,
    pub db_connected: bool,
    pub app_version: String,
    pub initial_route: String,
    pub theme: String,
}

#[tauri::command]
fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let theme = state
        .db
        .get_setting("theme")?
        .unwrap_or_else(|| "system".to_string());

    Ok(AppStatus {
        is_admin: state.is_admin,
        is_portable: state.paths.is_portable,
        data_dir: state.paths.data_dir.to_string_lossy().to_string(),
        logs_dir: state.paths.logs_dir.to_string_lossy().to_string(),
        db_path: state.paths.db_path.to_string_lossy().to_string(),
        db_connected: state.db.is_healthy(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        initial_route: state.initial_route.clone(),
        theme,
    })
}

#[tauri::command]
fn request_admin_elevation(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    current_route: String,
) -> Result<(), String> {
    let safe_route = uac::sanitize_route(&current_route);

    // Una vez activado por el usuario, permanece activo en cada sesión hasta que se desactive
    let _ = state.db.save_setting("always_run_as_admin", "true");

    let _ = state.db.record_audit_log(
        "uac",
        "elevation_requested",
        None,
        None,
        0,
        "info",
        Some(&format!(
            "Modo Administrador activado (persistente para próximas sesiones) desde '{safe_route}'."
        )),
    );

    if state.is_admin {
        return Ok(());
    }

    match uac::elevate_with_uac(&app_handle, &safe_route) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = state.db.record_audit_log(
                "uac",
                "elevation_cancelled_or_failed",
                None,
                None,
                0,
                "warning",
                Some(&err),
            );
            Err(err)
        }
    }
}

#[tauri::command]
fn disable_admin_mode(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    current_route: String,
) -> Result<bool, String> {
    let safe_route = uac::sanitize_route(&current_route);
    state.db.save_setting("always_run_as_admin", "false")?;

    let _ = state.db.record_audit_log(
        "uac",
        "admin_mode_disabled",
        None,
        None,
        0,
        "info",
        Some(&format!(
            "El usuario desactivó el Modo Administrador permanente desde '{safe_route}'."
        )),
    );

    if state.is_admin {
        uac::relaunch_as_standard_user(&app_handle, &safe_route)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn save_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    state.db.save_setting(&key, &value)?;

    let _ = state.db.record_audit_log(
        "settings",
        "setting_updated",
        None,
        None,
        0,
        "ok",
        Some(&format!("Configuración '{key}' actualizada a '{value}'.")),
    );

    Ok(())
}

#[tauri::command]
fn get_recent_audit_logs(
    state: State<'_, AppState>,
    limit: u32,
) -> Result<Vec<AuditLogEntry>, String> {
    state.db.get_recent_audit_logs(limit)
}

#[tauri::command]
fn get_system_overview() -> Result<SystemOverview, String> {
    collect_system_overview()
}

#[tauri::command]
async fn start_disk_scan(
    app_handle: AppHandle,
    scan_state: State<'_, ScanState>,
    root_path: String,
) -> Result<ScanSummary, String> {
    if scan_state
        .is_scanning
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "Ya hay un escaneo de disco en curso. Cancélalo o espera a que finalice.".to_string(),
        );
    }

    scan_state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel_flag = scan_state.cancel_flag.clone();
    let is_scanning = scan_state.is_scanning.clone();
    let sanitized_root = sanitize_scan_root(&root_path);

    let result = tokio::task::spawn_blocking(move || {
        execute_disk_scan(sanitized_root, cancel_flag, Some(app_handle))
    })
    .await
    .map_err(|err| format!("Error interno al ejecutar el hilo de escaneo: {err}"));

    is_scanning.store(false, Ordering::SeqCst);

    let index = result??;
    let summary = index.to_summary();

    let mut guard = scan_state
        .index
        .write()
        .map_err(|_| "No se pudo guardar el índice del escaneo en memoria.".to_string())?;
    *guard = Some(index);

    Ok(summary)
}

#[tauri::command]
fn cancel_disk_scan(scan_state: State<'_, ScanState>) -> Result<(), String> {
    scan_state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn get_scan_summary(scan_state: State<'_, ScanState>) -> Result<Option<ScanSummary>, String> {
    let guard = scan_state
        .index
        .read()
        .map_err(|_| "No se pudo leer el índice de escaneo en memoria.".to_string())?;
    Ok(guard.as_ref().map(|idx| idx.to_summary()))
}

#[tauri::command]
fn get_folder_children(
    scan_state: State<'_, ScanState>,
    folder_path: String,
) -> Result<Vec<FileNode>, String> {
    let guard = scan_state
        .index
        .read()
        .map_err(|_| "No se pudo leer el índice de escaneo en memoria.".to_string())?;

    let index = guard
        .as_ref()
        .ok_or_else(|| "Todavía no hay un escaneo completado en memoria.".to_string())?;

    Ok(index.get_children(Path::new(&folder_path)))
}

#[tauri::command]
fn get_files_by_section(
    scan_state: State<'_, ScanState>,
    section: FileSection,
    limit: usize,
) -> Result<Vec<FileNode>, String> {
    let guard = scan_state
        .index
        .read()
        .map_err(|_| "No se pudo leer el índice de escaneo en memoria.".to_string())?;

    let index = guard
        .as_ref()
        .ok_or_else(|| "Todavía no hay un escaneo completado en memoria.".to_string())?;

    Ok(index.get_section_files(section, limit))
}

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    scanner::actions::open_in_explorer(&path)
}

#[tauri::command]
fn delete_item_to_trash(
    app_state: State<'_, AppState>,
    scan_state: State<'_, ScanState>,
    path: String,
) -> Result<u64, String> {
    scanner::actions::delete_item_to_trash(&path, &scan_state, &app_state.db)
}

// ==================== COMANDOS PASO 3: MIGRADOR SEGURO A NAS / OTROS DISCOS ====================

#[tauri::command]
fn list_nas_targets(state: State<'_, AppState>) -> Result<Vec<NasTarget>, String> {
    state.db.list_nas_targets()
}

#[tauri::command]
fn save_nas_target(
    state: State<'_, AppState>,
    name: String,
    path: String,
) -> Result<NasTarget, String> {
    let trimmed_name = name.trim();
    let trimmed_path = path.trim();

    if trimmed_name.is_empty() {
        return Err("Escribe un nombre amigable para identificar este destino.".to_string());
    }
    if trimmed_path.is_empty() {
        return Err(
            "Indica una ruta local o de red válida (ej. \\\\192.168.1.50\\Respaldos o D:\\Backups)."
                .to_string(),
        );
    }

    let is_network = is_network_destination(trimmed_path);
    let target = state
        .db
        .save_nas_target(trimmed_name, trimmed_path, is_network)?;

    let _ = state.db.record_audit_log(
        "nas",
        "nas_target_saved",
        None,
        Some(trimmed_path),
        0,
        "ok",
        Some(&format!("Destino guardado: '{trimmed_name}'.")),
    );

    Ok(target)
}

#[tauri::command]
fn delete_nas_target(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.delete_nas_target(id)
}

#[tauri::command]
async fn test_nas_connection(
    state: State<'_, AppState>,
    path: String,
    username: Option<String>,
    password: Option<String>,
    remember_in_windows: bool,
) -> Result<NasConnectionStatus, String> {
    let path_clone = path.clone();
    let status = tokio::task::spawn_blocking(move || {
        run_nas_test(&path_clone, username, password, remember_in_windows)
    })
    .await
    .map_err(|err| format!("Error al probar conexión con el destino: {err}"))??;

    if status.reachable {
        let _ = state
            .db
            .update_nas_target_health(path.trim(), status.free_bytes);
    }

    Ok(status)
}

#[tauri::command]
async fn preview_transfer_source(
    source_path: String,
    dest_root: String,
) -> Result<TransferPreflight, String> {
    tokio::task::spawn_blocking(move || preflight_transfer(&source_path, &dest_root))
        .await
        .map_err(|err| format!("Error al calcular el tamaño previo de la transferencia: {err}"))?
}

#[tauri::command]
async fn scan_transfer_threats(source_path: String) -> Result<ThreatScanReport, String> {
    tokio::task::spawn_blocking(move || scan_source_for_threats(&source_path))
        .await
        .map_err(|err| format!("Error interno al analizar amenazas antes del copiado: {err}"))?
}

#[tauri::command]
fn record_threat_decision(
    state: State<'_, AppState>,
    source_path: String,
    dest_root: String,
    continued_by_user: bool,
    findings_count: usize,
    summary: String,
) -> Result<(), String> {
    let action = if continued_by_user {
        "threat_consent_accepted"
    } else {
        "threat_scan_blocked"
    };
    let status = if continued_by_user { "warning" } else { "info" };
    let details = if continued_by_user {
        format!(
            "El usuario aceptó continuar bajo su responsabilidad omitiendo {findings_count} advertencia(s) de seguridad: {summary}"
        )
    } else {
        format!(
            "Copiado detenido por el usuario tras detectar {findings_count} elemento(s) de riesgo: {summary}"
        )
    };

    state.db.record_audit_log(
        "nas",
        action,
        Some(source_path.trim()),
        Some(dest_root.trim()),
        0,
        status,
        Some(&details),
    )?;
    Ok(())
}

#[tauri::command]
async fn start_safe_transfer(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    scan_state: State<'_, ScanState>,
    mover_state: State<'_, MoverState>,
    request: TransferRequest,
) -> Result<TransferResult, String> {
    if mover_state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "Ya hay una transferencia en curso. Espera a que finalice o cancélala primero."
                .to_string(),
        );
    }

    mover_state.pause_flag.store(false, Ordering::SeqCst);
    mover_state.cancel_flag.store(false, Ordering::SeqCst);

    let pause_flag = mover_state.pause_flag.clone();
    let cancel_flag = mover_state.cancel_flag.clone();
    let is_running = mover_state.is_running.clone();
    let req_clone = request.clone();

    let exec_result = tokio::task::spawn_blocking(move || {
        execute_safe_transfer(&req_clone, pause_flag, cancel_flag, Some(app_handle))
    })
    .await
    .map_err(|err| format!("Error interno al ejecutar el motor de migración: {err}"));

    is_running.store(false, Ordering::SeqCst);
    mover_state.pause_flag.store(false, Ordering::SeqCst);

    match exec_result? {
        Ok(res) => {
            let _ = app_state.db.record_transfer_history(
                &res.source_path,
                &res.dest_path,
                res.mode.as_db_str(),
                res.files_count,
                res.total_bytes,
                &res.status,
                None,
                res.duration_ms,
            );

            let _ = app_state.db.record_audit_log(
                "nas",
                "nas_transfer_completed",
                Some(&res.source_path),
                Some(&res.dest_path),
                i64::try_from(res.total_bytes).unwrap_or(i64::MAX),
                "ok",
                Some(&res.summary_message),
            );

            if res.local_space_freed {
                if let Ok(mut guard) = scan_state.index.write() {
                    if let Some(index) = guard.as_mut() {
                        index.remove_deleted_path(Path::new(&res.source_path), res.total_bytes);
                    }
                }
            }

            Ok(res)
        }
        Err((status, error_msg, files_count, total_bytes, duration_ms)) => {
            let _ = app_state.db.record_transfer_history(
                request.source_path.trim(),
                request.dest_root.trim(),
                request.mode.as_db_str(),
                files_count,
                total_bytes,
                &status,
                Some(&error_msg),
                duration_ms,
            );

            let _ = app_state.db.record_audit_log(
                "nas",
                "nas_transfer_aborted",
                Some(request.source_path.trim()),
                Some(request.dest_root.trim()),
                0,
                "warning",
                Some(&error_msg),
            );

            Err(error_msg)
        }
    }
}

#[tauri::command]
async fn finalize_transfer_skip_verification(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    scan_state: State<'_, ScanState>,
    mover_state: State<'_, MoverState>,
    request: TransferRequest,
) -> Result<TransferResult, String> {
    if mover_state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Ya hay una transferencia en curso.".to_string());
    }

    let req_clone = request.clone();
    let exec_result = tokio::task::spawn_blocking(move || {
        finalize_transfer_without_verification(&req_clone, Some(app_handle))
    })
    .await
    .map_err(|err| format!("Error interno al finalizar la migración: {err}"));

    mover_state.is_running.store(false, Ordering::SeqCst);

    let res = exec_result??;

    let _ = app_state.db.record_transfer_history(
        &res.source_path,
        &res.dest_path,
        res.mode.as_db_str(),
        res.files_count,
        res.total_bytes,
        &res.status,
        None,
        res.duration_ms,
    );

    let _ = app_state.db.record_audit_log(
        "nas",
        "phase2_warning_ignored",
        Some(&res.source_path),
        Some(&res.dest_path),
        i64::try_from(res.total_bytes).unwrap_or(i64::MAX),
        "warning",
        Some(&format!(
            "El usuario ignoró la advertencia del Paso 2 (xxHash3) y completó el proceso: {}",
            res.summary_message
        )),
    );

    if res.local_space_freed {
        if let Ok(mut guard) = scan_state.index.write() {
            if let Some(index) = guard.as_mut() {
                index.remove_deleted_path(Path::new(&res.source_path), res.total_bytes);
            }
        }
    }

    Ok(res)
}

#[tauri::command]
fn pause_transfer(mover_state: State<'_, MoverState>) -> Result<(), String> {
    mover_state.pause_flag.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn resume_transfer(mover_state: State<'_, MoverState>) -> Result<(), String> {
    mover_state.pause_flag.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn cancel_transfer(mover_state: State<'_, MoverState>) -> Result<(), String> {
    mover_state.cancel_flag.store(true, Ordering::SeqCst);
    mover_state.pause_flag.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn get_transfer_history(
    state: State<'_, AppState>,
    limit: u32,
) -> Result<Vec<TransferHistoryEntry>, String> {
    state.db.get_transfer_history(limit)
}

// ==================== COMANDOS PASO 4: GESTOR, DESINSTALADOR Y REUBICADOR DE APPS ====================

#[tauri::command]
async fn list_installed_apps(
    app_handle: AppHandle,
    apps_state: State<'_, AppsState>,
    include_uwp: bool,
) -> Result<Vec<InstalledApp>, String> {
    let apps_arc = apps_state.apps.clone();
    let gen_arc = apps_state.scan_generation.clone();
    let temp_state = AppsState {
        apps: apps_arc,
        scan_generation: gen_arc,
    };

    tokio::task::spawn_blocking(move || list_and_enrich_apps(include_uwp, &temp_state, app_handle))
        .await
        .map_err(|err| format!("Error interno al listar aplicaciones instaladas: {err}"))?
}

#[tauri::command]
fn check_app_running_processes(
    apps_state: State<'_, AppsState>,
    app_id: String,
) -> Result<Vec<RunningProcessInfo>, String> {
    find_app_processes(&app_id, &apps_state)
}

#[tauri::command]
fn close_app_processes(pids: Vec<u32>) -> Result<u32, String> {
    kill_app_processes(&pids)
}

#[tauri::command]
async fn run_app_uninstaller(
    app_state: State<'_, AppState>,
    apps_state: State<'_, AppsState>,
    app_id: String,
) -> Result<UninstallExecutionResult, String> {
    let app = {
        let guard = apps_state
            .apps
            .read()
            .map_err(|_| "No se pudo leer el inventario de aplicaciones.".to_string())?;
        guard
            .get(&app_id)
            .cloned()
            .ok_or_else(|| "No se encontró la aplicación seleccionada.".to_string())?
    };

    // Validación temprana de UAC antes de lanzar hilo bloqueante
    if matches!(app.registry_hive.as_deref(), Some("HKLM64") | Some("HKLM32"))
        && !uac::is_running_as_admin()
    {
        return Err(
            "NEEDS_ADMIN: Esta aplicación está instalada para todo el equipo y requiere activar el Modo Administrador para desinstalarse."
                .to_string(),
        );
    }

    let app_clone = app.clone();
    let result = tokio::task::spawn_blocking(move || run_uninstaller_process(&app_clone))
        .await
        .map_err(|err| format!("Error al esperar la finalización del desinstalador: {err}"))??;

    let _ = app_state.db.record_audit_log(
        "apps",
        "uninstall",
        app.install_location.as_deref(),
        None,
        i64::try_from(app.real_size_bytes.unwrap_or(app.estimated_size_bytes)).unwrap_or(0),
        if result.completed { "ok" } else { "warning" },
        Some(&result.message),
    );

    Ok(result)
}

#[tauri::command]
async fn scan_app_leftovers(
    app_name: String,
    publisher: Option<String>,
    old_install_location: Option<String>,
    registry_hive: Option<String>,
    registry_subkey: Option<String>,
) -> Result<Vec<LeftoverItem>, String> {
    tokio::task::spawn_blocking(move || {
        find_app_leftovers(
            &app_name,
            publisher.as_deref(),
            old_install_location.as_deref(),
            registry_hive.as_deref(),
            registry_subkey.as_deref(),
        )
    })
    .await
    .map_err(|err| format!("Error al escanear residuos de la aplicación: {err}"))?
}

#[tauri::command]
fn clean_app_leftovers(
    app_state: State<'_, AppState>,
    items: Vec<LeftoverCleanRequest>,
    use_recycle_bin: bool,
) -> Result<LeftoverCleanResult, String> {
    run_clean_leftovers(&items, use_recycle_bin, &app_state.db)
}

#[tauri::command]
async fn preflight_relocate_app(
    apps_state: State<'_, AppsState>,
    app_id: String,
    dest_parent_dir: String,
) -> Result<RelocatePreflight, String> {
    let temp_state = AppsState {
        apps: apps_state.apps.clone(),
        scan_generation: apps_state.scan_generation.clone(),
    };
    tokio::task::spawn_blocking(move || check_relocate_app(&app_id, &dest_parent_dir, &temp_state))
        .await
        .map_err(|err| format!("Error al verificar los requisitos de reubicación: {err}"))?
}

#[tauri::command]
async fn execute_relocate_app(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    apps_state: State<'_, AppsState>,
    mover_state: State<'_, MoverState>,
    scan_state: State<'_, ScanState>,
    app_id: String,
    dest_parent_dir: String,
    close_running_first: bool,
) -> Result<TransferResult, String> {
    run_relocate_app(
        app_handle,
        app_id,
        dest_parent_dir,
        close_running_first,
        &apps_state,
        &mover_state,
        &scan_state,
        &app_state.db,
    )
    .await
}

// ==================== COMANDOS PASO 5: LIMPIADOR DE CACHÉ Y APPS SIN USO ====================

#[tauri::command]
async fn scan_cache_targets(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    cleaner_state: State<'_, CleanerState>,
    inactive_days_threshold: u32,
) -> Result<CacheScanReport, String> {
    let user_settings = load_settings_from_db(&app_state.db, app_state.paths.is_portable);
    let excluded_paths = user_settings.cleaner_excluded_paths;
    let temp_state = CleanerState {
        last_report: cleaner_state.last_report.clone(),
        is_cleaning: cleaner_state.is_cleaning.clone(),
    };
    tokio::task::spawn_blocking(move || {
        run_cache_scan(
            inactive_days_threshold,
            &excluded_paths,
            &temp_state,
            Some(app_handle),
        )
    })
    .await
    .map_err(|err| format!("Error interno al analizar cachés limpiables: {err}"))?
}

#[tauri::command]
async fn execute_cache_clean(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    cleaner_state: State<'_, CleanerState>,
    target_ids: Vec<String>,
    use_recycle_bin: bool,
    close_running_apps: bool,
) -> Result<CacheCleanResult, String> {
    let temp_state = CleanerState {
        last_report: cleaner_state.last_report.clone(),
        is_cleaning: cleaner_state.is_cleaning.clone(),
    };

    let res = tokio::task::spawn_blocking(move || {
        run_cache_clean(
            &target_ids,
            use_recycle_bin,
            close_running_apps,
            &temp_state,
            Some(app_handle),
        )
    })
    .await
    .map_err(|err| format!("Error interno al ejecutar la limpieza de caché: {err}"))??;

    let _ = app_state.db.record_audit_log(
        "cleaner",
        "cache_clean",
        None,
        if use_recycle_bin {
            Some("Papelera de Reciclaje")
        } else {
            None
        },
        i64::try_from(res.bytes_freed).unwrap_or(i64::MAX),
        "ok",
        Some(&format!(
            "Limpieza de caché: {} archivo(s) eliminado(s), {} en uso omitido(s).",
            res.files_deleted, res.files_skipped_in_use
        )),
    );

    Ok(res)
}

#[tauri::command]
fn close_cleaner_blocking_apps(process_names: Vec<String>) -> Result<u32, String> {
    kill_cleaner_apps(&process_names)
}

// ==================== COMANDOS PASO 6: MONITOR Y LIBERADOR DE MEMORIA RAM ====================

#[tauri::command]
fn get_ram_snapshot(ram_state: State<'_, RamState>) -> Result<RamSnapshot, String> {
    collect_ram_snapshot(&ram_state)
}

#[tauri::command]
async fn optimize_ram(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    purge_standby: bool,
    exclude_group_keys: Vec<String>,
) -> Result<RamOptimizeResult, String> {
    let user_settings = load_settings_from_db(&app_state.db, app_state.paths.is_portable);
    let mut merged_exclusions = exclude_group_keys;
    merged_exclusions.extend(user_settings.ram_excluded_processes);

    let handle_clone = app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let ram_state = handle_clone.state::<RamState>();
        run_optimize_ram(purge_standby, &merged_exclusions, &ram_state)
    })
    .await
    .map_err(|err| format!("Error interno al optimizar la memoria RAM: {err}"))??;

    let total_freed = res.freed_bytes.saturating_add(res.standby_freed_bytes);
    let _ = app_state.db.record_audit_log(
        "ram",
        "optimize_ram",
        None,
        None,
        i64::try_from(total_freed).unwrap_or(i64::MAX),
        "ok",
        Some(&format!(
            "Optimización RAM: uso {:.1}% -> {:.1}% ({} proceso(s) recortado(s){}).",
            res.before.usage_percent,
            res.after.usage_percent,
            res.processes_trimmed,
            if res.standby_purged {
                ", Standby List purgada"
            } else {
                ""
            }
        )),
    );

    Ok(res)
}

#[tauri::command]
fn close_process_group(
    app_state: State<'_, AppState>,
    ram_state: State<'_, RamState>,
    pids: Vec<u32>,
    group_name: String,
) -> Result<CloseGroupResult, String> {
    let res = kill_process_group(&pids, &group_name, &ram_state)?;
    let _ = app_state.db.record_audit_log(
        "ram",
        "close_app",
        Some(&group_name),
        None,
        0,
        if res.closed_count > 0 { "ok" } else { "warning" },
        Some(&res.message),
    );
    Ok(res)
}

#[tauri::command]
fn get_ram_auto_config(auto_state: State<'_, RamAutoState>) -> Result<RamAutoConfig, String> {
    auto_state
        .config
        .read()
        .map(|guard| guard.clone())
        .map_err(|_| "No se pudo leer la configuración automática de RAM.".to_string())
}

#[tauri::command]
fn set_ram_auto_config(
    app_state: State<'_, AppState>,
    auto_state: State<'_, RamAutoState>,
    config: RamAutoConfig,
) -> Result<RamAutoConfig, String> {
    let saved = save_auto_config_to_db(&app_state.db, config)?;
    if let Ok(mut guard) = auto_state.config.write() {
        *guard = saved.clone();
    }
    let _ = app_state.db.record_audit_log(
        "ram",
        "setting_updated",
        None,
        None,
        0,
        "ok",
        Some(&format!(
            "Auto-liberación de RAM: {} (umbral {}%, cooldown {} min).",
            if saved.enabled { "activada" } else { "desactivada" },
            saved.threshold_percent,
            saved.cooldown_minutes
        )),
    );
    Ok(saved)
}

// ==================== COMANDOS PASO 7: AJUSTES, AUDITORÍA Y PROTECCIÓN DE CIERRE ====================

#[tauri::command]
fn get_all_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    Ok(load_settings_from_db(&state.db, state.paths.is_portable))
}

#[tauri::command]
fn update_all_settings(
    state: State<'_, AppState>,
    watcher_state: State<'_, WatcherState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let previous = load_settings_from_db(&state.db, state.paths.is_portable);
    let saved = save_settings_to_db(&state.db, settings, state.paths.is_portable)?;

    watcher_state.update_from_settings(&saved);

    // Solo toca HKCU\...\Run en Modo Instalado y únicamente cuando cambia start_with_windows
    if !state.paths.is_portable && previous.start_with_windows != saved.start_with_windows {
        sync_windows_autostart(saved.start_with_windows, state.paths.is_portable)?;
    }

    let _ = state.db.record_audit_log(
        "settings",
        "settings_updated",
        None,
        None,
        0,
        "ok",
        Some(&format!(
            "Ajustes guardados (tema: {}, Papelera por defecto: {}, detector automático: {}, exclusiones RAM: {}, exclusiones caché: {}).",
            saved.theme,
            if saved.default_use_recycle_bin { "sí" } else { "no" },
            if saved.watch_incoming_files { "activo" } else { "inactivo" },
            saved.ram_excluded_processes.len(),
            saved.cleaner_excluded_paths.len(),
        )),
    );

    Ok(saved)
}

#[tauri::command]
fn reset_settings_to_default(
    state: State<'_, AppState>,
    watcher_state: State<'_, WatcherState>,
) -> Result<AppSettings, String> {
    let previous = load_settings_from_db(&state.db, state.paths.is_portable);
    let defaults = AppSettings::default();
    let saved = save_settings_to_db(&state.db, defaults, state.paths.is_portable)?;

    watcher_state.update_from_settings(&saved);

    if !state.paths.is_portable && previous.start_with_windows {
        let _ = sync_windows_autostart(false, state.paths.is_portable);
    }

    let _ = state.db.record_audit_log(
        "settings",
        "settings_reset",
        None,
        None,
        0,
        "ok",
        Some("Se restauraron todos los ajustes a sus valores predeterminados."),
    );

    Ok(saved)
}

#[tauri::command]
fn open_data_folder(state: State<'_, AppState>) -> Result<(), String> {
    let dir = &state.paths.data_dir;
    if !dir.exists() {
        std::fs::create_dir_all(dir)
            .map_err(|err| format!("No se pudo preparar la carpeta de datos: {err}"))?;
    }

    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(dir)
            .spawn()
            .map_err(|err| format!("No se pudo abrir la carpeta de datos en el Explorador: {err}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|err| format!("No se pudo abrir la carpeta de datos: {err}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|err| format!("No se pudo abrir la carpeta de datos: {err}"))?;
    }

    Ok(())
}

#[tauri::command]
fn export_audit_logs(
    state: State<'_, AppState>,
    format: String,
    dest_path: String,
) -> Result<usize, String> {
    let trimmed = dest_path.trim();
    if trimmed.is_empty() {
        return Err("Debes seleccionar un archivo de destino para exportar el historial.".to_string());
    }
    let count = export_audit_logs_to_file(&state.db, &format, Path::new(trimmed))?;
    let _ = state.db.record_audit_log(
        "settings",
        "audit_exported",
        None,
        Some(trimmed),
        0,
        "ok",
        Some(&format!(
            "Historial exportado en formato {} ({count} registros).",
            format.to_uppercase()
        )),
    );
    Ok(count)
}

#[tauri::command]
fn clear_old_audit_logs(
    state: State<'_, AppState>,
    keep_last_days: u32,
) -> Result<usize, String> {
    let deleted = state.db.clear_old_audit_logs(keep_last_days)?;
    let _ = state.db.record_audit_log(
        "settings",
        "audit_cleaned",
        None,
        None,
        0,
        "ok",
        Some(&format!(
            "Se eliminaron {deleted} registros antiguos (conservando los últimos {keep_last_days} días)."
        )),
    );
    Ok(deleted)
}

#[tauri::command]
fn is_critical_operation_running(mover_state: State<'_, MoverState>) -> bool {
    mover_state.is_running.load(Ordering::SeqCst)
}

// ==================== COMANDOS DE AUTO-ACTUALIZACIÓN (GITHUB RELEASES) ====================

#[tauri::command]
async fn check_for_updates(state: State<'_, AppState>) -> Result<UpdateCheckResult, String> {
    let is_portable = state.paths.is_portable;
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("diskvault-update-check".to_string())
        .spawn(move || {
            let _ = tx.send(check_github_updates(is_portable));
        })
        .map_err(|err| format!("No se pudo iniciar la comprobación de actualizaciones: {err}"))?;

    rx.await
        .map_err(|_| "La comprobación de actualizaciones finalizó inesperadamente.".to_string())?
}

#[tauri::command]
async fn download_and_install_update(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: InstallUpdateRequest,
) -> Result<(), String> {
    let is_portable = state.paths.is_portable;
    let logs_dir = state.paths.logs_dir.clone();
    let version = request.version.clone();

    let _ = state.db.record_audit_log(
        "system",
        "update_install_started",
        None,
        Some(&request.asset_name),
        0,
        "info",
        Some(&format!(
            "El usuario confirmó la instalación de la actualización v{version}."
        )),
    );

    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("diskvault-update-install".to_string())
        .spawn(move || {
            let _ = tx.send(download_and_apply_update(
                &app_handle,
                &request,
                is_portable,
                &logs_dir,
            ));
        })
        .map_err(|err| format!("No se pudo iniciar el hilo de actualización: {err}"))?;

    rx.await
        .map_err(|_| "El proceso de descarga e instalación finalizó inesperadamente.".to_string())?
}

// ==================== COMANDOS DE TEMA NATIVO DE WINDOWS ====================

#[tauri::command]
fn get_windows_theme() -> WindowsThemeInfo {
    read_windows_theme_info()
}

#[tauri::command]
fn apply_native_window_theme(window: tauri::WebviewWindow, mode: String) -> Result<(), String> {
    let tauri_theme = resolve_tauri_window_theme(&mode);
    window
        .set_theme(tauri_theme)
        .map_err(|err| format!("No se pudo sincronizar el tema nativo de la ventana: {err}"))
}

// ==================== COMANDOS DE DETECTOR AUTOMÁTICO DE ARCHIVOS NUEVOS ====================

#[tauri::command]
fn get_watched_folders_info(
    watcher_state: State<'_, WatcherState>,
) -> Result<WatchedFoldersInfo, String> {
    Ok(watcher_state.get_watched_folders_info())
}

#[tauri::command]
fn respond_incoming_file_decision(
    state: State<'_, AppState>,
    source_path: String,
    dest_root: Option<String>,
    copied_to_nas: bool,
    total_bytes: u64,
) -> Result<(), String> {
    let action = if copied_to_nas {
        "incoming_file_sent_to_nas"
    } else {
        "incoming_file_kept_local"
    };
    let details = if copied_to_nas {
        format!(
            "El usuario eligió copiar el archivo/carpeta detectado directamente hacia '{}'.",
            dest_root.as_deref().unwrap_or("NAS")
        )
    } else {
        "El usuario eligió conservar el archivo/carpeta detectado solo en este PC.".to_string()
    };

    state.db.record_audit_log(
        "watcher",
        action,
        Some(source_path.trim()),
        dest_root.as_deref().map(str::trim),
        i64::try_from(total_bytes).unwrap_or(0),
        "info",
        Some(&details),
    )?;
    Ok(())
}

#[tauri::command]
fn send_test_incoming_notification(app_handle: AppHandle) -> Result<IncomingFileEvent, String> {
    trigger_test_incoming_notification(&app_handle)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            updater::cleanup_old_update_artifacts();

            let paths = resolve_app_paths()
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;

            let db = Database::init(&paths.db_path)
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;

            let is_admin = uac::is_running_as_admin();
            let initial_route = uac::parse_initial_route_from_args();
            let saved_settings = load_settings_from_db(&db, paths.is_portable);

            // Modo Administrador activo por defecto en cada sesión hasta que el usuario lo desactive
            if saved_settings.always_run_as_admin && !is_admin && !uac::has_no_auto_elevate_flag()
            {
                match uac::spawn_elevated_instance(&initial_route) {
                    Ok(true) => {
                        let _ = db.record_audit_log(
                            "uac",
                            "auto_elevation_triggered",
                            None,
                            None,
                            0,
                            "info",
                            Some(
                                "Inicio automático en Modo Administrador (preferencia persistente activa).",
                            ),
                        );
                        std::process::exit(0);
                    }
                    Ok(false) => {}
                    Err(err) => {
                        let _ = db.record_audit_log(
                            "uac",
                            "elevation_cancelled_or_failed",
                            None,
                            None,
                            0,
                            "warning",
                            Some(&err),
                        );
                    }
                }
            }

            let mode_label = if paths.is_portable {
                "Modo Portable"
            } else {
                "Modo Instalado"
            };
            let privilege_label = if is_admin {
                "Administrador"
            } else {
                "Estándar"
            };

            let _ = db.record_audit_log(
                "system",
                "app_started",
                Some(&paths.data_dir.to_string_lossy()),
                None,
                0,
                "ok",
                Some(&format!(
                    "Inicio correcto ({mode_label}, permisos: {privilege_label}, vista inicial: {initial_route})."
                )),
            );

            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.set_theme(resolve_tauri_window_theme(&saved_settings.theme));
            }

            let ram_auto_cfg = load_auto_config_from_db(&db);

            app.manage(AppState {
                paths,
                db,
                initial_route,
                is_admin,
            });
            app.manage(ScanState::default());
            app.manage(MoverState::default());
            app.manage(AppsState::default());
            app.manage(CleanerState::default());
            app.manage(RamState::default());
            app.manage(RamAutoState::from_config(ram_auto_cfg));
            app.manage(WatcherState::from_settings(&saved_settings));

            spawn_ram_auto_monitor(app.handle().clone());
            spawn_incoming_file_watcher(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            request_admin_elevation,
            disable_admin_mode,
            save_setting,
            get_recent_audit_logs,
            get_system_overview,
            start_disk_scan,
            cancel_disk_scan,
            get_scan_summary,
            get_folder_children,
            get_files_by_section,
            open_in_explorer,
            delete_item_to_trash,
            list_nas_targets,
            save_nas_target,
            delete_nas_target,
            test_nas_connection,
            preview_transfer_source,
            scan_transfer_threats,
            record_threat_decision,
            start_safe_transfer,
            finalize_transfer_skip_verification,
            pause_transfer,
            resume_transfer,
            cancel_transfer,
            get_transfer_history,
            list_installed_apps,
            check_app_running_processes,
            close_app_processes,
            run_app_uninstaller,
            scan_app_leftovers,
            clean_app_leftovers,
            preflight_relocate_app,
            execute_relocate_app,
            scan_cache_targets,
            execute_cache_clean,
            close_cleaner_blocking_apps,
            get_ram_snapshot,
            optimize_ram,
            close_process_group,
            get_ram_auto_config,
            set_ram_auto_config,
            get_all_settings,
            update_all_settings,
            reset_settings_to_default,
            open_data_folder,
            export_audit_logs,
            clear_old_audit_logs,
            is_critical_operation_running,
            check_for_updates,
            download_and_install_update,
            get_windows_theme,
            apply_native_window_theme,
            get_watched_folders_info,
            respond_incoming_file_decision,
            send_test_incoming_notification,
        ])
        .run(tauri::generate_context!())
        .expect("Error crítico al iniciar DiskVault Clean");
}
