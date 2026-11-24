use crate::cleaner::rules::{
    build_all_cache_rules, compute_default_selected, is_cleaner_target_path_safe, CacheGroup,
    CacheRuleSpec, CacheTarget, SafetyLevel,
};
use crate::cleaner::services::WindowsUpdateServiceGuard;
use crate::storage::settings::is_path_excluded_by_user;
use crate::uac;
use jwalk::WalkDir;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

/// Evento en vivo durante el análisis de cachés (`cache-scan-progress`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheScanProgress {
    pub current_group: String,
    pub scanned_targets: usize,
    pub total_targets: usize,
    pub bytes_found: u64,
}

/// Reporte completo del análisis de cachés limpiables.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheScanReport {
    pub total_reclaimable_bytes: u64,
    pub safe_reclaimable_bytes: u64,
    pub review_reclaimable_bytes: u64,
    pub admin_locked_bytes: u64,
    pub targets: Vec<CacheTarget>,
    pub duration_ms: u64,
    pub is_admin: bool,
    pub inactive_days_threshold: u32,
}

/// Evento en vivo durante la limpieza (`cache-clean-progress`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCleanProgress {
    pub current_target_name: String,
    pub targets_done: usize,
    pub targets_total: usize,
    pub bytes_freed_so_far: u64,
}

/// Resultado detallado por cada objetivo limpiado.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerTargetCleanResult {
    pub target_id: String,
    pub target_name: String,
    pub bytes_freed: u64,
    pub files_deleted: u64,
    pub files_skipped_in_use: u64,
    pub status: String, // "ok" | "partial" | "skipped" | "error"
    pub message: String,
}

/// Recibo final de la limpieza ejecutada.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCleanResult {
    pub bytes_freed: u64,
    pub files_deleted: u64,
    pub files_skipped_in_use: u64,
    pub per_target_results: Vec<PerTargetCleanResult>,
    pub duration_ms: u64,
    pub wuauserv_restarted: bool,
}

/// Estado gestionado por Tauri que cachea los `CacheTarget` descubiertos para que el frontend
/// solo envíe `target_ids` y jamás pueda inyectar rutas arbitrarias.
pub struct CleanerState {
    pub last_report: Arc<RwLock<Option<CacheScanReport>>>,
    pub is_cleaning: Arc<AtomicBool>,
}

impl Default for CleanerState {
    fn default() -> Self {
        Self {
            last_report: Arc::new(RwLock::new(None)),
            is_cleaning: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Procesos conocidos que el limpiador puede cerrar únicamente si el usuario lo solicita.
const ALLOWED_CLOSABLE_APPS: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "brave.exe",
    "opera.exe",
    "firefox.exe",
    "discord.exe",
    "slack.exe",
    "spotify.exe",
    "ms-teams.exe",
    "teams.exe",
    "steam.exe",
    "code.exe",
];

pub fn close_cleaner_blocking_apps(process_names: &[String]) -> Result<u32, String> {
    if process_names.is_empty() {
        return Ok(0);
    }

    let wanted: HashSet<String> = process_names
        .iter()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| ALLOWED_CLOSABLE_APPS.contains(&s.as_str()))
        .collect();

    if wanted.is_empty() {
        return Ok(0);
    }

    let self_pid = std::process::id();
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut closed = 0u32;
    for (pid, proc_info) in sys.processes() {
        if pid.as_u32() == self_pid || pid.as_u32() <= 4 {
            continue;
        }
        let pname = proc_info.name().to_string_lossy().to_ascii_lowercase();
        if wanted.contains(&pname) && proc_info.kill() {
            closed += 1;
        }
    }

    Ok(closed)
}

#[cfg(windows)]
fn query_recycle_bin_stats() -> (u64, u64) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};

    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };

    let res = unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) };
    if res.is_ok() {
        (
            u64::try_from(info.i64Size.max(0)).unwrap_or(0),
            u64::try_from(info.i64NumItems.max(0)).unwrap_or(0),
        )
    } else {
        (0, 0)
    }
}

#[cfg(not(windows))]
fn query_recycle_bin_stats() -> (u64, u64) {
    (0, 0)
}

#[cfg(windows)]
fn empty_windows_recycle_bin() -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{
        SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
    };

    let flags = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND;
    unsafe { SHEmptyRecycleBinW(HWND::default(), PCWSTR::null(), flags) }
        .map_err(|err| format!("No se pudo vaciar la Papelera de Reciclaje: {err}"))
}

#[cfg(not(windows))]
fn empty_windows_recycle_bin() -> Result<(), String> {
    Err("Vaciar la Papelera de Windows solo está disponible en Windows.".to_string())
}

fn measure_path_cleanable(
    path: &Path,
    skip_recent_minutes: Option<u64>,
    file_prefix_filter: Option<&str>,
    now: SystemTime,
) -> (u64, u64) {
    if !path.exists() {
        return (0, 0);
    }

    let min_age = skip_recent_minutes.map(|mins| Duration::from_secs(mins * 60));
    let prefix_lower = file_prefix_filter.map(|p| p.to_ascii_lowercase());

    let mut total_bytes = 0u64;
    let mut total_files = 0u64;

    for entry in WalkDir::new(path).follow_links(false).skip_hidden(false) {
        let Ok(item) = entry else {
            continue;
        };
        if !item.file_type().is_file() {
            continue;
        }

        if let Some(ref prefix) = prefix_lower {
            let fname = item.file_name().to_string_lossy().to_ascii_lowercase();
            if !fname.starts_with(prefix.as_str()) {
                continue;
            }
        }

        let Ok(meta) = item.metadata() else {
            continue;
        };

        if let Some(threshold) = min_age {
            if let Ok(mtime) = meta.modified() {
                match now.duration_since(mtime) {
                    Ok(age) if age < threshold => continue,
                    Err(_) => continue,
                    _ => {}
                }
            }
        }

        total_bytes = total_bytes.saturating_add(meta.len());
        total_files = total_files.saturating_add(1);
    }

    (total_bytes, total_files)
}

fn collect_running_process_names() -> HashSet<String> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .map(|p| p.name().to_string_lossy().to_ascii_lowercase())
        .collect()
}

fn evaluate_rule(
    rule: CacheRuleSpec,
    running_procs: &HashSet<String>,
    excluded_paths: &[String],
    is_admin: bool,
    now: SystemTime,
) -> Option<CacheTarget> {
    if rule.group == CacheGroup::RecycleBin {
        let (size_bytes, file_count) = query_recycle_bin_stats();
        if size_bytes == 0 && file_count == 0 {
            return None;
        }
        return Some(CacheTarget {
            id: rule.id,
            group: rule.group,
            name: rule.name,
            description: rule.description,
            safety: rule.safety,
            requires_admin: rule.requires_admin,
            paths: vec!["Papelera de Reciclaje (todas las unidades)".to_string()],
            size_bytes,
            file_count,
            is_locked_by_running_app: false,
            running_process_names: Vec::new(),
            default_selected: compute_default_selected(rule.safety, rule.requires_admin, is_admin),
            inactive_days: None,
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: true,
        });
    }

    let mut existing_paths = Vec::new();
    let mut total_bytes = 0u64;
    let mut total_files = 0u64;

    for p in &rule.paths {
        if !is_cleaner_target_path_safe(p, rule.group)
            || is_path_excluded_by_user(p, excluded_paths)
            || !p.exists()
        {
            continue;
        }
        let (bytes, files) = measure_path_cleanable(
            p,
            rule.skip_recent_minutes,
            rule.file_prefix_filter.as_deref(),
            now,
        );
        if bytes > 0 || files > 0 {
            existing_paths.push(p.to_string_lossy().to_string());
            total_bytes = total_bytes.saturating_add(bytes);
            total_files = total_files.saturating_add(files);
        }
    }

    if total_bytes == 0 && total_files == 0 {
        return None;
    }

    let matched_procs: Vec<String> = rule
        .process_names
        .iter()
        .filter(|p| running_procs.contains(&p.to_ascii_lowercase()))
        .cloned()
        .collect();

    Some(CacheTarget {
        id: rule.id,
        group: rule.group,
        name: rule.name,
        description: rule.description,
        safety: rule.safety,
        requires_admin: rule.requires_admin,
        paths: existing_paths,
        size_bytes: total_bytes,
        file_count: total_files,
        is_locked_by_running_app: !matched_procs.is_empty(),
        running_process_names: matched_procs,
        default_selected: compute_default_selected(rule.safety, rule.requires_admin, is_admin),
        inactive_days: rule.precomputed_inactive_days,
        skip_recent_minutes: rule.skip_recent_minutes,
        file_prefix_filter: rule.file_prefix_filter,
        service_to_pause: rule.service_to_pause,
        direct_delete_only: rule.direct_delete_only,
    })
}

/// Escanea en paralelo todos los objetivos limpiables con `rayon` emitiendo `"cache-scan-progress"`.
pub fn scan_cache_targets(
    inactive_days_threshold: u32,
    excluded_paths: &[String],
    cleaner_state: &CleanerState,
    app_handle: Option<AppHandle>,
) -> Result<CacheScanReport, String> {
    let started_at = Instant::now();
    let safe_threshold = inactive_days_threshold.clamp(1, 3650);
    let is_admin = uac::is_running_as_admin();
    let running_procs = collect_running_process_names();
    let rules = build_all_cache_rules(safe_threshold);
    let total_targets = rules.len();
    let now = SystemTime::now();

    let scanned_counter = AtomicUsize::new(0);
    let bytes_counter = AtomicU64::new(0);

    let mut targets: Vec<CacheTarget> = rules
        .into_par_iter()
        .filter_map(|rule| {
            let group_label = rule.group.display_name().to_string();
            let evaluated = evaluate_rule(rule, &running_procs, excluded_paths, is_admin, now);
            let done = scanned_counter.fetch_add(1, Ordering::Relaxed) + 1;
            let bytes_total = if let Some(ref item) = evaluated {
                bytes_counter.fetch_add(item.size_bytes, Ordering::Relaxed) + item.size_bytes
            } else {
                bytes_counter.load(Ordering::Relaxed)
            };

            if let Some(ref handle) = app_handle {
                let _ = handle.emit(
                    "cache-scan-progress",
                    CacheScanProgress {
                        current_group: group_label,
                        scanned_targets: done,
                        total_targets,
                        bytes_found: bytes_total,
                    },
                );
            }

            evaluated
        })
        .collect();

    // Orden por grupo lógico y mayor a menor peso dentro de cada grupo
    targets.sort_by(|a, b| {
        let rank = |g: CacheGroup| match g {
            CacheGroup::WindowsSystem => 0,
            CacheGroup::Browsers => 1,
            CacheGroup::InactiveApps => 2,
            CacheGroup::GraphicsShaders => 3,
            CacheGroup::RecycleBin => 4,
        };
        rank(a.group)
            .cmp(&rank(b.group))
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });

    let mut total_reclaimable_bytes = 0u64;
    let mut safe_reclaimable_bytes = 0u64;
    let mut review_reclaimable_bytes = 0u64;
    let mut admin_locked_bytes = 0u64;

    for t in &targets {
        total_reclaimable_bytes = total_reclaimable_bytes.saturating_add(t.size_bytes);
        if t.requires_admin && !is_admin {
            admin_locked_bytes = admin_locked_bytes.saturating_add(t.size_bytes);
        } else {
            match t.safety {
                SafetyLevel::Safe => {
                    safe_reclaimable_bytes = safe_reclaimable_bytes.saturating_add(t.size_bytes);
                }
                SafetyLevel::Review => {
                    review_reclaimable_bytes =
                        review_reclaimable_bytes.saturating_add(t.size_bytes);
                }
                SafetyLevel::Protected => {}
            }
        }
    }

    let report = CacheScanReport {
        total_reclaimable_bytes,
        safe_reclaimable_bytes,
        review_reclaimable_bytes,
        admin_locked_bytes,
        targets,
        duration_ms: u64::try_from(started_at.elapsed().as_millis()).unwrap_or(0),
        is_admin,
        inactive_days_threshold: safe_threshold,
    };

    if let Ok(mut guard) = cleaner_state.last_report.write() {
        *guard = Some(report.clone());
    }

    Ok(report)
}

/// Limpia únicamente el CONTENIDO de un directorio (nunca borra la carpeta padre),
/// soportando envío a Papelera (`use_recycle_bin`) o eliminación directa, y omitiendo
/// sin abortar archivos en uso (`PermissionDenied` / sharing violation 32/33).
pub fn clean_directory_contents(
    dir_path: &Path,
    use_recycle_bin: bool,
    skip_recent_minutes: Option<u64>,
    file_prefix_filter: Option<&str>,
    now: SystemTime,
) -> (u64, u64, u64) {
    if !dir_path.is_dir() {
        return (0, 0, 0);
    }

    let min_age = skip_recent_minutes.map(|m| Duration::from_secs(m * 60));
    let prefix_lower = file_prefix_filter.map(|p| p.to_ascii_lowercase());

    clean_dir_recursive(
        dir_path,
        use_recycle_bin,
        min_age,
        prefix_lower.as_deref(),
        now,
    )
}

fn clean_dir_recursive(
    current: &Path,
    use_recycle_bin: bool,
    min_age: Option<Duration>,
    prefix_lower: Option<&str>,
    now: SystemTime,
) -> (u64, u64, u64) {
    let mut bytes_freed = 0u64;
    let mut files_deleted = 0u64;
    let mut skipped_in_use = 0u64;

    let Ok(entries) = fs::read_dir(current) else {
        return (0, 0, 1);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        // Nunca seguir enlaces simbólicos ni junctions
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            let (b, f, s) = clean_dir_recursive(
                &path,
                use_recycle_bin,
                min_age,
                prefix_lower,
                now,
            );
            bytes_freed = bytes_freed.saturating_add(b);
            files_deleted = files_deleted.saturating_add(f);
            skipped_in_use = skipped_in_use.saturating_add(s);

            if prefix_lower.is_none() {
                let _ = fs::remove_dir(&path);
            }
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        if let Some(prefix) = prefix_lower {
            let fname = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if !fname.starts_with(prefix) {
                continue;
            }
        }

        let Ok(meta) = entry.metadata() else {
            continue;
        };

        if let Some(threshold) = min_age {
            if let Ok(mtime) = meta.modified() {
                match now.duration_since(mtime) {
                    Ok(age) if age < threshold => continue,
                    Err(_) => continue,
                    _ => {}
                }
            }
        }

        let size = meta.len();
        let delete_res = if use_recycle_bin {
            trash::delete(&path).map_err(|e| e.to_string())
        } else {
            fs::remove_file(&path).map_err(|e| e.to_string())
        };

        match delete_res {
            Ok(()) => {
                bytes_freed = bytes_freed.saturating_add(size);
                files_deleted = files_deleted.saturating_add(1);
            }
            Err(_) => {
                // Archivo bloqueado / PermissionDenied / sharing violation 32 o 33 -> omitir con serenidad
                skipped_in_use = skipped_in_use.saturating_add(1);
            }
        }
    }

    (bytes_freed, files_deleted, skipped_in_use)
}

/// Ejecuta la limpieza segura de los `target_ids` seleccionados emitiendo `"cache-clean-progress"`.
pub fn execute_cache_clean(
    target_ids: &[String],
    use_recycle_bin: bool,
    close_running_apps: bool,
    cleaner_state: &CleanerState,
    app_handle: Option<AppHandle>,
) -> Result<CacheCleanResult, String> {
    if target_ids.is_empty() {
        return Err("Selecciona al menos una categoría de caché para limpiar.".to_string());
    }

    if cleaner_state
        .is_cleaning
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Ya hay una limpieza de caché en curso. Espera a que termine.".to_string());
    }

    let result = run_clean_inner(
        target_ids,
        use_recycle_bin,
        close_running_apps,
        cleaner_state,
        app_handle,
    );

    cleaner_state.is_cleaning.store(false, Ordering::SeqCst);
    result
}

fn run_clean_inner(
    target_ids: &[String],
    use_recycle_bin: bool,
    close_running_apps: bool,
    cleaner_state: &CleanerState,
    app_handle: Option<AppHandle>,
) -> Result<CacheCleanResult, String> {
    let started_at = Instant::now();
    let is_admin = uac::is_running_as_admin();

    let selected_targets: Vec<CacheTarget> = {
        let guard = cleaner_state
            .last_report
            .read()
            .map_err(|_| "No se pudo leer el último análisis de caché.".to_string())?;
        let report = guard.as_ref().ok_or_else(|| {
            "Primero ejecuta el análisis de espacio recuperable antes de limpiar.".to_string()
        })?;

        let wanted: HashSet<&str> = target_ids.iter().map(String::as_str).collect();
        report
            .targets
            .iter()
            .filter(|t| wanted.contains(t.id.as_str()) && t.safety != SafetyLevel::Protected)
            .cloned()
            .collect()
    };

    if selected_targets.is_empty() {
        return Err("No se encontraron objetivos válidos para limpiar.".to_string());
    }

    if close_running_apps {
        let mut to_close = Vec::new();
        for t in &selected_targets {
            if t.is_locked_by_running_app {
                to_close.extend(t.running_process_names.iter().cloned());
            }
        }
        if !to_close.is_empty() {
            let closed = close_cleaner_blocking_apps(&to_close).unwrap_or(0);
            if closed > 0 {
                thread::sleep(Duration::from_millis(750));
            }
        }
    }

    // Si incluye Windows Update y hay permisos Admin, activa el RAII WindowsUpdateServiceGuard
    let needs_wuauserv = selected_targets
        .iter()
        .any(|t| t.service_to_pause.as_deref() == Some("wuauserv") && is_admin);
    let mut wu_guard = if needs_wuauserv {
        Some(WindowsUpdateServiceGuard::pause_if_running())
    } else {
        None
    };

    let now = SystemTime::now();
    let total_targets = selected_targets.len();
    let mut bytes_freed = 0u64;
    let mut files_deleted = 0u64;
    let mut files_skipped_in_use = 0u64;
    let mut per_target_results = Vec::with_capacity(total_targets);

    for (idx, target) in selected_targets.iter().enumerate() {
        if let Some(ref handle) = app_handle {
            let _ = handle.emit(
                "cache-clean-progress",
                CacheCleanProgress {
                    current_target_name: target.name.clone(),
                    targets_done: idx,
                    targets_total: total_targets,
                    bytes_freed_so_far: bytes_freed,
                },
            );
        }

        if target.requires_admin && !is_admin {
            per_target_results.push(PerTargetCleanResult {
                target_id: target.id.clone(),
                target_name: target.name.clone(),
                bytes_freed: 0,
                files_deleted: 0,
                files_skipped_in_use: 0,
                status: "skipped".to_string(),
                message: "Omitido: requiere activar Modo Administrador.".to_string(),
            });
            continue;
        }

        if target.group == CacheGroup::RecycleBin {
            match empty_windows_recycle_bin() {
                Ok(()) => {
                    bytes_freed = bytes_freed.saturating_add(target.size_bytes);
                    files_deleted = files_deleted.saturating_add(target.file_count);
                    per_target_results.push(PerTargetCleanResult {
                        target_id: target.id.clone(),
                        target_name: target.name.clone(),
                        bytes_freed: target.size_bytes,
                        files_deleted: target.file_count,
                        files_skipped_in_use: 0,
                        status: "ok".to_string(),
                        message: "Papelera de Reciclaje vaciada correctamente.".to_string(),
                    });
                }
                Err(err) => {
                    per_target_results.push(PerTargetCleanResult {
                        target_id: target.id.clone(),
                        target_name: target.name.clone(),
                        bytes_freed: 0,
                        files_deleted: 0,
                        files_skipped_in_use: 0,
                        status: "error".to_string(),
                        message: err,
                    });
                }
            }
            continue;
        }

        // Cachés de sistema (Windows Update, Windows\Temp, DeliveryOpt) siempre se purgan directo
        let target_use_trash = use_recycle_bin && !target.direct_delete_only;
        let mut target_bytes = 0u64;
        let mut target_files = 0u64;
        let mut target_skipped = 0u64;

        for raw_path in &target.paths {
            let p = Path::new(raw_path);
            if !is_cleaner_target_path_safe(p, target.group) {
                continue;
            }
            let (b, f, s) = clean_directory_contents(
                p,
                target_use_trash,
                target.skip_recent_minutes,
                target.file_prefix_filter.as_deref(),
                now,
            );
            target_bytes = target_bytes.saturating_add(b);
            target_files = target_files.saturating_add(f);
            target_skipped = target_skipped.saturating_add(s);
        }

        bytes_freed = bytes_freed.saturating_add(target_bytes);
        files_deleted = files_deleted.saturating_add(target_files);
        files_skipped_in_use = files_skipped_in_use.saturating_add(target_skipped);

        let (status, message) = if target_skipped == 0 {
            ("ok".to_string(), "Limpiado por completo.".to_string())
        } else if target_files > 0 {
            (
                "partial".to_string(),
                format!("Limpiado parcialmente ({target_skipped} archivo(s) en uso omitidos)."),
            )
        } else {
            (
                "partial".to_string(),
                format!("Los archivos estaban en uso ({target_skipped} omitidos)."),
            )
        };

        per_target_results.push(PerTargetCleanResult {
            target_id: target.id.clone(),
            target_name: target.name.clone(),
            bytes_freed: target_bytes,
            files_deleted: target_files,
            files_skipped_in_use: target_skipped,
            status,
            message,
        });
    }

    let wuauserv_restarted = wu_guard.as_mut().map(|g| g.restore_now()).unwrap_or(false);

    if let Some(ref handle) = app_handle {
        let _ = handle.emit(
            "cache-clean-progress",
            CacheCleanProgress {
                current_target_name: "Limpieza completada".to_string(),
                targets_done: total_targets,
                targets_total: total_targets,
                bytes_freed_so_far: bytes_freed,
            },
        );
    }

    Ok(CacheCleanResult {
        bytes_freed,
        files_deleted,
        files_skipped_in_use,
        per_target_results,
        duration_ms: u64::try_from(started_at.elapsed().as_millis()).unwrap_or(0),
        wuauserv_restarted,
    })
}

#[cfg(test)]
mod tests {
    use super::clean_directory_contents;
    use std::fs::{self, OpenOptions};
    use std::time::{Duration, SystemTime};

    /// Prueba obligatoria 4: Limpieza resiliente que borra contenido, preserva carpeta padre y reporta bytes.
    #[test]
    fn limpieza_resiliente_preserva_carpeta_padre_y_reporta_bytes() {
        let temp_root = std::env::temp_dir().join(format!(
            "diskvault_resilient_clean_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        let sub = temp_root.join("subcarpeta");
        fs::create_dir_all(&sub).unwrap();

        let file_old = temp_root.join("viejo.tmp");
        let file_sub = sub.join("nested.tmp");
        let file_recent = temp_root.join("reciente.tmp");

        fs::write(&file_old, vec![b'a'; 2048]).unwrap();
        fs::write(&file_sub, vec![b'b'; 1024]).unwrap();
        fs::write(&file_recent, vec![b'c'; 512]).unwrap();

        let thirty_mins_ago = SystemTime::now() - Duration::from_secs(30 * 60);
        OpenOptions::new()
            .write(true)
            .open(&file_old)
            .unwrap()
            .set_modified(thirty_mins_ago)
            .unwrap();
        OpenOptions::new()
            .write(true)
            .open(&file_sub)
            .unwrap()
            .set_modified(thirty_mins_ago)
            .unwrap();

        let (freed, deleted, skipped) =
            clean_directory_contents(&temp_root, false, Some(5), None, SystemTime::now());

        assert_eq!(freed, 3072);
        assert_eq!(deleted, 2);
        assert_eq!(skipped, 0);
        // La carpeta padre debe seguir existiendo y el archivo de hace < 5 min también
        assert!(temp_root.is_dir());
        assert!(!file_old.exists());
        assert!(!file_sub.exists());
        assert!(file_recent.exists());

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn filtro_de_prefijo_solo_elimina_thumbcache() {
        let temp_root = std::env::temp_dir().join(format!(
            "diskvault_thumb_filter_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).unwrap();

        let thumb = temp_root.join("thumbcache_256.db");
        let icon = temp_root.join("iconcache_32.db");
        fs::write(&thumb, vec![b'x'; 4096]).unwrap();
        fs::write(&icon, vec![b'y'; 4096]).unwrap();

        let (freed, deleted, _) = clean_directory_contents(
            &temp_root,
            false,
            None,
            Some("thumbcache_"),
            SystemTime::now(),
        );

        assert_eq!(freed, 4096);
        assert_eq!(deleted, 1);
        assert!(!thumb.exists());
        assert!(icon.exists());

        let _ = fs::remove_dir_all(&temp_root);
    }
}
