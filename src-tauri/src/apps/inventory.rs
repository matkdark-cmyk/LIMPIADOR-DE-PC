use crate::apps::icons::extract_icon_data_url;
use crate::security;
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use jwalk::WalkDir;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

/// Aplicación instalada (Win32 desde Registro o UWP desde Microsoft Store).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub publisher: Option<String>,
    pub version: Option<String>,
    pub install_location: Option<String>,
    pub display_icon: Option<String>,
    pub icon_data_url: Option<String>,
    pub uninstall_string: Option<String>,
    pub quiet_uninstall_string: Option<String>,
    pub estimated_size_bytes: u64,
    pub real_size_bytes: Option<u64>,
    pub install_date: Option<String>,
    pub last_used_timestamp: Option<String>,
    pub registry_hive: Option<String>,
    pub registry_subkey: Option<String>,
    pub app_type: String,
    pub package_full_name: Option<String>,
    pub is_relocated: bool,
    pub relocated_target: Option<String>,
    pub can_relocate: bool,
    pub relocate_disabled_reason: Option<String>,
}

/// Evento incremental enviado al frontend mientras se calculan pesos reales e íconos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMetadataUpdate {
    pub app_id: String,
    pub real_size_bytes: Option<u64>,
    pub last_used_timestamp: Option<String>,
    pub icon_data_url: Option<String>,
}

/// Evento emitido al finalizar el cálculo en segundo plano.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsScanComplete {
    pub total_processed: usize,
}

/// Estado en memoria del inventario de aplicaciones gestionado por Tauri.
pub struct AppsState {
    pub apps: Arc<RwLock<HashMap<String, InstalledApp>>>,
    pub scan_generation: Arc<AtomicU64>,
}

impl Default for AppsState {
    fn default() -> Self {
        Self {
            apps: Arc::new(RwLock::new(HashMap::new())),
            scan_generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

/// Carpetas genéricas del sistema o del perfil de usuario que NUNCA son un `install_location` propio de una app.
const GENERIC_INSTALL_DIRS: &[&str] = &[
    "program files",
    "program files (x86)",
    "programdata",
    "users",
    "windows",
    "windows\\installer",
    "windows\\system32",
    "windows\\syswow64",
    "temp",
];

/// Subcarpetas genéricas directas dentro del perfil del usuario (`C:\Users\<usuario>\...`).
const GENERIC_USER_SUBDIRS: &[&str] = &[
    "appdata",
    "appdata\\local",
    "appdata\\local\\programs",
    "appdata\\local\\temp",
    "appdata\\roaming",
    "desktop",
    "downloads",
    "descargas",
    "documents",
    "documentos",
    "music",
    "pictures",
    "videos",
];

/// Valida que una ruta sea una carpeta específica de aplicación y NO un directorio genérico ni crítico de Windows.
pub fn is_safe_specific_install_path(path: &Path) -> bool {
    let raw = path.to_string_lossy().trim().to_string();
    if raw.is_empty() {
        return false;
    }

    if security::is_protected_path(path) {
        return false;
    }

    let mut normalized = raw.replace('/', "\\").to_ascii_lowercase();
    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }

    // Debe tener unidad tipo C:\...
    let bytes = normalized.as_bytes();
    if bytes.len() <= 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\'
    {
        return false;
    }

    let rel = &normalized[3..];
    if rel.is_empty() {
        return false;
    }

    if GENERIC_INSTALL_DIRS.contains(&rel) {
        return false;
    }

    // Bloquea C:\Users\<usuario> y carpetas genéricas directas dentro del perfil
    if let Some(after_users) = rel.strip_prefix("users\\") {
        let parts: Vec<&str> = after_users
            .split('\\')
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() <= 1 {
            return false;
        }
        let user_rel = parts[1..].join("\\");
        if GENERIC_USER_SUBDIRS.contains(&user_rel.as_str()) {
            return false;
        }
    }

    true
}

/// Normaliza fechas `YYYYMMDD` del Registro a `YYYY-MM-DD`.
fn normalize_registry_date(raw: Option<String>) -> Option<String> {
    let s = raw?.trim().to_string();
    if s.len() == 8 && s.chars().all(|c| c.is_ascii_digit()) {
        return Some(format!("{}-{}-{}", &s[0..4], &s[4..6], &s[6..8]));
    }
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn parse_date_to_rfc3339(date_str: &str) -> Option<String> {
    let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
    let dt = Utc.from_utc_datetime(&date.and_hms_opt(12, 0, 0)?);
    Some(dt.to_rfc3339())
}

fn system_time_to_rfc3339(time: SystemTime) -> String {
    let dt: DateTime<Utc> = time.into();
    dt.to_rfc3339()
}

/// Intenta inferir `install_location` de forma segura desde `DisplayIcon` o `UninstallString`
/// cuando el Registro no especifica `InstallLocation`.
fn infer_install_location_safely(
    display_icon: Option<&str>,
    uninstall_string: Option<&str>,
) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(icon_raw) = display_icon {
        if let Some((icon_path, _)) = crate::apps::icons::parse_display_icon_spec(icon_raw) {
            if let Some(parent) = icon_path.parent() {
                candidates.push(parent.to_path_buf());
            }
        }
    }

    if let Some(uninst_raw) = uninstall_string {
        if let Ok((exe, _)) = crate::apps::uninstaller::parse_uninstall_command(uninst_raw) {
            let exe_lower = exe.to_ascii_lowercase();
            if !exe_lower.contains("msiexec") && !exe_lower.contains("rundll32") {
                if let Some(parent) = Path::new(&exe).parent() {
                    candidates.push(parent.to_path_buf());
                }
            }
        }
    }

    for candidate in candidates {
        if is_safe_specific_install_path(&candidate) && candidate.exists() && candidate.is_dir() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

/// Detecta si `install_location` es un Junction/Reparse Point ya reubicado.
#[cfg(windows)]
fn detect_relocation(path: &Path) -> (bool, Option<String>) {
    if junction::exists(path).unwrap_or(false) {
        let target = junction::get_target(path)
            .ok()
            .map(|p| p.to_string_lossy().to_string());
        return (true, target);
    }

    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            let target = std::fs::read_link(path)
                .ok()
                .map(|p| p.to_string_lossy().to_string());
            return (true, target);
        }
    }

    (false, None)
}

#[cfg(not(windows))]
fn detect_relocation(path: &Path) -> (bool, Option<String>) {
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            let target = std::fs::read_link(path)
                .ok()
                .map(|p| p.to_string_lossy().to_string());
            return (true, target);
        }
    }
    (false, None)
}

/// Determina si una app Win32 puede reubicarse a otro disco local y, si no, el motivo claro en español.
fn evaluate_relocation_eligibility(
    app_type: &str,
    install_location: Option<&str>,
    is_relocated: bool,
) -> (bool, Option<String>) {
    if app_type == "uwp" {
        return (
            false,
            Some(
                "Las aplicaciones de Microsoft Store están protegidas por Windows en WindowsApps y no deben moverse con enlaces manuales."
                    .to_string(),
            ),
        );
    }

    if is_relocated {
        return (
            false,
            Some("Esta aplicación ya fue reubicada a otro disco mediante un enlace NTFS.".to_string()),
        );
    }

    match install_location {
        None => (
            false,
            Some("No se encontró una carpeta de instalación dedicada para esta aplicación.".to_string()),
        ),
        Some(loc) => {
            let p = Path::new(loc);
            if !is_safe_specific_install_path(p) {
                (
                    false,
                    Some(
                        "La carpeta de instalación es compartida o está protegida por Windows y no es seguro moverla."
                            .to_string(),
                    ),
                )
            } else if !p.exists() || !p.is_dir() {
                (
                    false,
                    Some("La carpeta de instalación registrada ya no existe en disco.".to_string()),
                )
            } else {
                (true, None)
            }
        }
    }
}

/// Lee las 3 ramas estándar de Uninstall del Registro de Windows (`HKLM64`, `HKLM32`, `HKCU`).
#[cfg(windows)]
fn collect_win32_registry_apps() -> Vec<InstalledApp> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;

    let sources = [
        (
            "HKLM64",
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            KEY_READ | KEY_WOW64_64KEY,
        ),
        (
            "HKLM32",
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            KEY_READ | KEY_WOW64_32KEY,
        ),
        (
            "HKCU",
            RegKey::predef(HKEY_CURRENT_USER),
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            KEY_READ,
        ),
    ];

    let mut dedup: HashMap<String, InstalledApp> = HashMap::new();

    for (hive_label, root_key, sub_path, flags) in sources {
        let Ok(uninstall_key) = root_key.open_subkey_with_flags(sub_path, flags) else {
            continue;
        };

        for subkey_name in uninstall_key.enum_keys().filter_map(Result::ok) {
            let Ok(app_key) = uninstall_key.open_subkey_with_flags(&subkey_name, flags) else {
                continue;
            };

            // Filtrar componentes internos del sistema
            let sys_component: u32 = app_key.get_value("SystemComponent").unwrap_or(0);
            if sys_component == 1 {
                continue;
            }

            // Filtrar parches/actualizaciones sueltas ligadas a un padre
            let parent_key: String = app_key.get_value("ParentKeyName").unwrap_or_default();
            if !parent_key.trim().is_empty() {
                continue;
            }

            let display_name: String = app_key
                .get_value("DisplayName")
                .unwrap_or_default();
            let name = display_name.trim().to_string();
            if name.is_empty() {
                continue;
            }

            let uninstall_string: Option<String> = app_key
                .get_value::<String, _>("UninstallString")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let quiet_uninstall_string: Option<String> = app_key
                .get_value::<String, _>("QuietUninstallString")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            if uninstall_string.is_none() && quiet_uninstall_string.is_none() {
                continue;
            }

            let publisher: Option<String> = app_key
                .get_value::<String, _>("Publisher")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let version: Option<String> = app_key
                .get_value::<String, _>("DisplayVersion")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let display_icon: Option<String> = app_key
                .get_value::<String, _>("DisplayIcon")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let raw_install_loc: Option<String> = app_key
                .get_value::<String, _>("InstallLocation")
                .ok()
                .map(|s| s.trim().trim_matches('"').to_string())
                .filter(|s| !s.is_empty());

            let install_location = match raw_install_loc {
                Some(loc) if is_safe_specific_install_path(Path::new(&loc)) && Path::new(&loc).exists() => {
                    Some(loc)
                }
                _ => infer_install_location_safely(
                    display_icon.as_deref(),
                    uninstall_string.as_deref(),
                ),
            };

            let estimated_kb: u32 = app_key.get_value("EstimatedSize").unwrap_or(0);
            let estimated_size_bytes = u64::from(estimated_kb).saturating_mul(1024);

            let install_date = normalize_registry_date(
                app_key.get_value::<String, _>("InstallDate").ok(),
            );

            let (is_relocated, relocated_target) = match install_location.as_deref() {
                Some(loc) => detect_relocation(Path::new(loc)),
                None => (false, None),
            };

            let (can_relocate, relocate_disabled_reason) =
                evaluate_relocation_eligibility("win32", install_location.as_deref(), is_relocated);

            let initial_last_used = install_date
                .as_deref()
                .and_then(parse_date_to_rfc3339);

            let app = InstalledApp {
                id: format!("win32:{hive_label}:{subkey_name}"),
                name: name.clone(),
                publisher,
                version: version.clone(),
                install_location,
                display_icon,
                icon_data_url: None,
                uninstall_string,
                quiet_uninstall_string,
                estimated_size_bytes,
                real_size_bytes: None,
                install_date,
                last_used_timestamp: initial_last_used,
                registry_hive: Some(hive_label.to_string()),
                registry_subkey: Some(subkey_name),
                app_type: "win32".to_string(),
                package_full_name: None,
                is_relocated,
                relocated_target,
                can_relocate,
                relocate_disabled_reason,
            };

            // Deduplicación inteligente: conserva la entrada más completa
            let dedup_key = format!(
                "{}|{}",
                name.to_ascii_lowercase(),
                version.unwrap_or_default().to_ascii_lowercase()
            );

            let should_replace = match dedup.get(&dedup_key) {
                None => true,
                Some(existing) => {
                    let new_score = usize::from(app.install_location.is_some()) * 2
                        + usize::from(app.estimated_size_bytes > 0)
                        + usize::from(app.display_icon.is_some());
                    let old_score = usize::from(existing.install_location.is_some()) * 2
                        + usize::from(existing.estimated_size_bytes > 0)
                        + usize::from(existing.display_icon.is_some());
                    new_score > old_score
                }
            };

            if should_replace {
                dedup.insert(dedup_key, app);
            }
        }
    }

    dedup.into_values().collect()
}

#[cfg(not(windows))]
fn collect_win32_registry_apps() -> Vec<InstalledApp> {
    Vec::new()
}

/// Lee aplicaciones de Microsoft Store (UWP/Appx) mediante PowerShell silencioso sin ventana.
#[cfg(windows)]
fn collect_uwp_apps() -> Vec<InstalledApp> {
    use serde::Deserialize;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    #[derive(Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct RawAppx {
        name: Option<String>,
        package_full_name: Option<String>,
        publisher: Option<String>,
        version: Option<String>,
        install_location: Option<String>,
    }

    let script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; @(Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable -and $_.SignatureKind -ne 'System' } | Select-Object Name, PackageFullName, Publisher, Version, InstallLocation) | ConvertTo-Json -Compress";

    let output = match Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(out) if out.status.success() => out,
        _ => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() || stdout == "null" {
        return Vec::new();
    }

    let raw_list: Vec<RawAppx> = if stdout.starts_with('[') {
        serde_json::from_str(&stdout).unwrap_or_default()
    } else if stdout.starts_with('{') {
        serde_json::from_str::<RawAppx>(&stdout)
            .map(|single| vec![single])
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    raw_list
        .into_iter()
        .filter_map(|item| {
            let pkg_full = item.package_full_name?.trim().to_string();
            if pkg_full.is_empty() {
                return None;
            }
            let raw_name = item.name.unwrap_or_else(|| pkg_full.clone());
            // Limpia prefijos largos tipo "Microsoft.WindowsCalculator" -> "WindowsCalculator"
            let friendly_name = raw_name
                .split('.')
                .last()
                .filter(|part| part.len() >= 3)
                .unwrap_or(&raw_name)
                .to_string();

            let publisher = item.publisher.and_then(|p| {
                // Extrae CN=... si viene en formato de certificado
                let cleaned = p
                    .split(',')
                    .find_map(|seg| seg.trim().strip_prefix("CN="))
                    .unwrap_or(p.trim())
                    .trim_matches('"')
                    .to_string();
                if cleaned.is_empty() {
                    None
                } else {
                    Some(cleaned)
                }
            });

            let install_location = item
                .install_location
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let (can_relocate, relocate_disabled_reason) =
                evaluate_relocation_eligibility("uwp", install_location.as_deref(), false);

            Some(InstalledApp {
                id: format!("uwp:{pkg_full}"),
                name: friendly_name,
                publisher,
                version: item.version,
                install_location,
                display_icon: None,
                icon_data_url: None,
                uninstall_string: None,
                quiet_uninstall_string: None,
                estimated_size_bytes: 0,
                real_size_bytes: None,
                install_date: None,
                last_used_timestamp: None,
                registry_hive: None,
                registry_subkey: None,
                app_type: "uwp".to_string(),
                package_full_name: Some(pkg_full),
                is_relocated: false,
                relocated_target: None,
                can_relocate,
                relocate_disabled_reason,
            })
        })
        .collect()
}

#[cfg(not(windows))]
fn collect_uwp_apps() -> Vec<InstalledApp> {
    Vec::new()
}

/// Calcula tamaño exacto en disco y fecha estimada de última actividad de una carpeta de aplicación.
fn measure_app_folder(
    app: &InstalledApp,
) -> (Option<u64>, Option<String>) {
    // Si la app ya está reubicada vía junction, medimos su carpeta destino real
    let scan_path_str = if app.is_relocated {
        app.relocated_target
            .as_deref()
            .or(app.install_location.as_deref())
    } else {
        app.install_location.as_deref()
    };

    let mut real_size: Option<u64> = None;
    let mut latest_time: Option<SystemTime> = None;

    if let Some(dir_str) = scan_path_str {
        let dir = Path::new(dir_str);
        if dir.exists() && dir.is_dir() {
            let mut sum_bytes = 0u64;
            for entry in WalkDir::new(dir).follow_links(false).skip_hidden(false) {
                if let Ok(item) = entry {
                    if item.file_type().is_file() {
                        if let Ok(meta) = item.metadata() {
                            sum_bytes = sum_bytes.saturating_add(meta.len());

                            let is_exe = item
                                .path()
                                .extension()
                                .and_then(|e| e.to_str())
                                .map(|e| e.eq_ignore_ascii_case("exe"))
                                .unwrap_or(false);

                            if is_exe {
                                if let Ok(modified) = meta.modified() {
                                    if latest_time.map(|t| modified > t).unwrap_or(true) {
                                        latest_time = Some(modified);
                                    }
                                }
                                if let Ok(accessed) = meta.accessed() {
                                    if latest_time.map(|t| accessed > t).unwrap_or(true) {
                                        latest_time = Some(accessed);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if sum_bytes > 0 {
                real_size = Some(sum_bytes);
            }
        }
    }

    // Revisa también modificación de carpeta homónima en %LOCALAPPDATA% o %APPDATA% para estimar actividad reciente
    if app.name.len() >= 4 {
        let candidate_roots = [dirs::data_local_dir(), dirs::config_dir()];
        for root_opt in candidate_roots {
            if let Some(root) = root_opt {
                let candidate = root.join(&app.name);
                if let Ok(meta) = std::fs::metadata(&candidate) {
                    if let Ok(modified) = meta.modified() {
                        if latest_time.map(|t| modified > t).unwrap_or(true) {
                            latest_time = Some(modified);
                        }
                    }
                }
            }
        }
    }

    let last_used = latest_time
        .map(system_time_to_rfc3339)
        .or_else(|| app.install_date.as_deref().and_then(parse_date_to_rfc3339));

    (real_size, last_used)
}

/// Construye la lista inicial rápida (<1s), la guarda en `AppsState` y lanza en segundo plano
/// el cálculo paralelo de peso real, última actividad e íconos emitiendo `"apps-metadata-update"`.
pub fn list_and_enrich_apps(
    include_uwp: bool,
    apps_state: &AppsState,
    app_handle: AppHandle,
) -> Result<Vec<InstalledApp>, String> {
    let mut apps = collect_win32_registry_apps();
    if include_uwp {
        apps.extend(collect_uwp_apps());
    }

    // Orden inicial de mayor a menor peso estimado
    apps.sort_by(|a, b| {
        b.estimated_size_bytes
            .cmp(&a.estimated_size_bytes)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    // Guarda inventario inicial en memoria e incrementa generación para cancelar cálculos viejos
    let generation = apps_state.scan_generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut guard = apps_state
            .apps
            .write()
            .map_err(|_| "No se pudo actualizar la caché de aplicaciones.".to_string())?;
        guard.clear();
        for app in &apps {
            guard.insert(app.id.clone(), app.clone());
        }
    }

    let snapshot = apps.clone();
    let apps_arc = apps_state.apps.clone();
    let gen_arc = apps_state.scan_generation.clone();

    // Cálculo paralelo en segundo plano sin bloquear el retorno inicial ni la UI
    tokio::spawn(async move {
        let _ = tokio::task::spawn_blocking(move || {
            let total = snapshot.len();
            let batch_size = 8usize;

            for chunk in snapshot.chunks(batch_size) {
                if gen_arc.load(Ordering::Relaxed) != generation {
                    return;
                }

                let updates: Vec<AppMetadataUpdate> = chunk
                    .par_iter()
                    .map(|app| {
                        let (real_size_bytes, last_used_timestamp) = measure_app_folder(app);
                        let icon_data_url = extract_icon_data_url(app.display_icon.as_deref());
                        AppMetadataUpdate {
                            app_id: app.id.clone(),
                            real_size_bytes,
                            last_used_timestamp,
                            icon_data_url,
                        }
                    })
                    .collect();

                if gen_arc.load(Ordering::Relaxed) != generation {
                    return;
                }

                // Sincroniza los pesos reales calculados en el estado gestionado de Rust
                if let Ok(mut guard) = apps_arc.write() {
                    for upd in &updates {
                        if let Some(entry) = guard.get_mut(&upd.app_id) {
                            if upd.real_size_bytes.is_some() {
                                entry.real_size_bytes = upd.real_size_bytes;
                            }
                            if upd.last_used_timestamp.is_some() {
                                entry.last_used_timestamp = upd.last_used_timestamp.clone();
                            }
                            if upd.icon_data_url.is_some() {
                                entry.icon_data_url = upd.icon_data_url.clone();
                            }
                        }
                    }
                }

                let _ = app_handle.emit("apps-metadata-update", &updates);
            }

            if gen_arc.load(Ordering::Relaxed) == generation {
                let _ = app_handle.emit(
                    "apps-scan-complete",
                    AppsScanComplete {
                        total_processed: total,
                    },
                );
            }
        })
        .await;
    });

    Ok(apps)
}

#[cfg(test)]
mod tests {
    use super::is_safe_specific_install_path;
    use std::path::Path;

    #[test]
    fn rechaza_carpetas_genericas_y_protegidas_como_install_location() {
        let unsafe_paths = [
            r"C:\",
            r"C:\Windows",
            r"C:\Windows\System32",
            r"C:\Program Files",
            r"C:\Program Files\",
            r"C:\Program Files (x86)",
            r"C:\ProgramData",
            r"C:\Users\Carlos",
            r"C:\Users\Carlos\AppData\Local",
            r"C:\Users\Carlos\Downloads",
        ];

        for p in unsafe_paths {
            assert!(
                !is_safe_specific_install_path(Path::new(p)),
                "La ruta genérica o protegida '{p}' debía rechazarse"
            );
        }
    }

    #[test]
    fn acepta_subcarpetas_dedicadas_de_aplicaciones() {
        let safe_paths = [
            r"C:\Program Files\MiApp",
            r"C:\Program Files (x86)\Steam\steamapps\common\Portal2",
            r"D:\Juegos\Cyberpunk 2077",
            r"C:\Users\Carlos\AppData\Local\Programs\Microsoft VS Code",
        ];

        for p in safe_paths {
            assert!(
                is_safe_specific_install_path(Path::new(p)),
                "La subcarpeta válida '{p}' debía aceptarse"
            );
        }
    }
}
