use crate::security;
use jwalk::WalkDir;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Nivel de riesgo del semáforo de seguridad del limpiador.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SafetyLevel {
    Safe,
    Review,
    Protected,
}

/// Grupo funcional en el que se organiza el limpiador de caché.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheGroup {
    WindowsSystem,
    Browsers,
    GraphicsShaders,
    InactiveApps,
    RecycleBin,
}

impl CacheGroup {
    pub fn display_name(self) -> &'static str {
        match self {
            CacheGroup::WindowsSystem => "Sistema Windows",
            CacheGroup::Browsers => "Navegadores Web",
            CacheGroup::GraphicsShaders => "Shaders Gráficos",
            CacheGroup::InactiveApps => "Apps sin Uso y Terceros",
            CacheGroup::RecycleBin => "Papelera de Reciclaje",
        }
    }
}

/// Objetivo limpiable evaluado y devuelto al frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheTarget {
    pub id: String,
    pub group: CacheGroup,
    pub name: String,
    pub description: String,
    pub safety: SafetyLevel,
    pub requires_admin: bool,
    pub paths: Vec<String>,
    pub size_bytes: u64,
    pub file_count: u64,
    pub is_locked_by_running_app: bool,
    pub running_process_names: Vec<String>,
    pub default_selected: bool,
    pub inactive_days: Option<u64>,
    pub skip_recent_minutes: Option<u64>,
    pub file_prefix_filter: Option<String>,
    pub service_to_pause: Option<String>,
    pub direct_delete_only: bool,
}

/// Definición interna de una regla antes de medir tamaños y procesos en disco.
#[derive(Debug, Clone)]
pub struct CacheRuleSpec {
    pub id: String,
    pub group: CacheGroup,
    pub name: String,
    pub description: String,
    pub safety: SafetyLevel,
    pub requires_admin: bool,
    pub paths: Vec<PathBuf>,
    pub process_names: Vec<String>,
    pub skip_recent_minutes: Option<u64>,
    pub file_prefix_filter: Option<String>,
    pub service_to_pause: Option<String>,
    pub direct_delete_only: bool,
    pub precomputed_inactive_days: Option<u64>,
}

/// Subcarpetas EXCLUSIVAS de caché permitidas dentro de perfiles Chromium.
const CHROMIUM_CACHE_SUBDIRS: &[&str] = &[
    r"Cache\Cache_Data",
    "Code Cache",
    "GPUCache",
    "DawnCache",
    "GrShaderCache",
];

/// Nombres exactos de carpetas de caché admitidos por el Escáner Inteligente de Apps Inactivas.
const INACTIVE_APP_CACHE_DIR_NAMES: &[&str] = &[
    "cache",
    "caches",
    "cache_data",
    "code cache",
    "gpucache",
    "dawncache",
    "shadercache",
];

/// Segmentos de privacidad de navegadores que JAMÁS pueden incluirse en ninguna ruta limpiable.
pub const FORBIDDEN_BROWSER_SEGMENTS: &[&str] = &[
    "cookies",
    "login data",
    "login data for account",
    "bookmarks",
    "history",
    "web data",
    "local storage",
    "session storage",
    "indexeddb",
    "extensions",
    "preferences",
    "secure preferences",
    "sessions",
    "passwords",
    "logins.json",
    "places.sqlite",
    "key4.db",
    "cert9.db",
    "favicons",
    "top sites",
    "visited links",
];

/// Rutas exactas dentro de `C:\Windows` explícitamente permitidas para el limpiador de caché.
/// NUNCA incluye `Prefetch`, `System32`, `WinSxS` ni la carpeta raíz `C:\Windows`.
const ALLOWED_WINDOWS_CACHE_PREFIXES: &[&str] = &[
    r"windows\temp",
    r"windows\softwaredistribution\download",
    r"windows\softwaredistribution\deliveryoptimization",
    r"windows\serviceprofiles\networkservice\appdata\local\microsoft\windows\deliveryoptimization\cache",
];

/// Directorios de primer nivel dentro de AppData excluidos del escáner genérico de apps inactivas
/// (porque ya los cubren reglas específicas o pertenecen a Windows/navegadores/GPU).
const INACTIVE_SCAN_EXCLUDED_TOP_DIRS: &[&str] = &[
    "microsoft",
    "windows",
    "google",
    "nvidia",
    "amd",
    "intel",
    "packages",
    "temp",
    "programs",
    "common",
    "d3dscache",
    "discord",
    "spotify",
    "slack",
    "code",
    "steam",
    "opera software",
    "bravesoftware",
    "mozilla",
    "crashdumps",
    "elevateddiagnostics",
    "connecteddevicesplatform",
    "comms",
    "publishers",
    "squirreltemp",
];

/// Tamaño mínimo (5 MiB) para reportar una caché inactiva autodescubierta.
pub const INACTIVE_APP_MIN_BYTES: u64 = 5 * 1024 * 1024;

/// Normaliza una ruta para comparaciones de prefijo/igualdad insensibles a mayúsculas.
fn normalize_path_lower(path: &Path) -> String {
    let mut s = path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// Valida que una ruta de caché de navegador jamás toque cookies, contraseñas, historial, favoritos o `places.sqlite`.
pub fn is_safe_browser_cache_path(path: &Path) -> bool {
    let norm = normalize_path_lower(path);

    for forbidden in FORBIDDEN_BROWSER_SEGMENTS {
        for segment in norm.split('\\') {
            if segment == *forbidden {
                return false;
            }
        }
    }

    norm.ends_with(r"\cache\cache_data")
        || norm.ends_with(r"\code cache")
        || norm.ends_with(r"\gpucache")
        || norm.ends_with(r"\dawncache")
        || norm.ends_with(r"\grshadercache")
        || norm.ends_with(r"\cache2")
        || norm.ends_with(r"\cache")
}

/// Comprueba si una ruta dentro de `C:\Windows` corresponde estrictamente a una de las 4 cachés whitelisted.
pub fn is_explicitly_allowed_windows_cache_path(path: &Path) -> bool {
    let trimmed = normalize_path_lower(path);

    if trimmed.contains(r"\prefetch")
        || trimmed.contains(r"\system32")
        || trimmed.contains(r"\winsxs")
        || trimmed.contains(r"\syswow64")
    {
        return false;
    }

    let bytes = trimmed.as_bytes();
    let rel = if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'\\'
    {
        &trimmed[3..]
    } else {
        return false;
    };

    ALLOWED_WINDOWS_CACHE_PREFIXES.iter().any(|allowed| {
        rel == *allowed
            || (rel.starts_with(allowed) && rel.as_bytes().get(allowed.len()) == Some(&b'\\'))
    })
}

/// Valida que cualquier ruta del limpiador sea segura (jamás `C:\Windows`, `System32`, `Prefetch` ni datos privados).
pub fn is_cleaner_target_path_safe(path: &Path, group: CacheGroup) -> bool {
    if group == CacheGroup::RecycleBin {
        return true;
    }

    let norm = normalize_path_lower(path);
    if norm.contains(r"\prefetch") {
        return false;
    }

    if group == CacheGroup::Browsers && !is_safe_browser_cache_path(path) {
        return false;
    }

    if security::is_protected_path(path) {
        return is_explicitly_allowed_windows_cache_path(path);
    }

    true
}

/// Calcula `default_selected` según el semáforo: solo `true` si `Safe` y cuenta con los permisos necesarios.
pub fn compute_default_selected(safety: SafetyLevel, requires_admin: bool, is_admin: bool) -> bool {
    safety == SafetyLevel::Safe && (!requires_admin || is_admin)
}

/// Descubre subcarpetas EXCLUSIVAS de caché dentro de un directorio `User Data` de un navegador Chromium.
pub fn discover_chromium_cache_paths(user_data_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if !user_data_dir.is_dir() {
        return found;
    }

    let Ok(entries) = std::fs::read_dir(user_data_dir) else {
        return found;
    };

    for entry in entries.flatten() {
        let profile_dir = entry.path();
        if !profile_dir.is_dir() {
            continue;
        }
        let Some(name) = profile_dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        let is_profile = lower == "default"
            || lower.starts_with("profile ")
            || lower == "guest profile"
            || lower == "system profile";
        if !is_profile {
            continue;
        }

        for sub in CHROMIUM_CACHE_SUBDIRS {
            let candidate = profile_dir.join(sub);
            if candidate.is_dir() && is_safe_browser_cache_path(&candidate) {
                found.push(candidate);
            }
        }
    }

    for top_cache in ["GrShaderCache", "ShaderCache"] {
        let candidate = user_data_dir.join(top_cache);
        if candidate.is_dir() && is_safe_browser_cache_path(&candidate) {
            found.push(candidate);
        }
    }

    found
}

/// Descubre subcarpetas de caché exclusivas para perfiles de Opera / Opera GX.
pub fn discover_opera_cache_paths(opera_base_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if !opera_base_dir.is_dir() {
        return found;
    }
    for sub in CHROMIUM_CACHE_SUBDIRS {
        let candidate = opera_base_dir.join(sub);
        if candidate.is_dir() && is_safe_browser_cache_path(&candidate) {
            found.push(candidate);
        }
    }
    found
}

/// Descubre carpetas `cache2` dentro de perfiles de Mozilla Firefox.
pub fn discover_firefox_cache_paths(profiles_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if !profiles_dir.is_dir() {
        return found;
    }
    let Ok(entries) = std::fs::read_dir(profiles_dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let cache2 = p.join("cache2");
        if cache2.is_dir() && is_safe_browser_cache_path(&cache2) {
            found.push(cache2);
        }
    }
    found
}

/// Mide tamaño total y fecha más reciente de modificación dentro de un directorio de caché.
fn measure_cache_dir_age_and_size(path: &Path) -> (u64, Option<SystemTime>) {
    let mut total_bytes = 0u64;
    let mut newest_mtime: Option<SystemTime> = None;

    for entry in WalkDir::new(path).follow_links(false).skip_hidden(false) {
        let Ok(item) = entry else {
            continue;
        };
        if !item.file_type().is_file() {
            continue;
        }
        let Ok(meta) = item.metadata() else {
            continue;
        };
        total_bytes = total_bytes.saturating_add(meta.len());
        if let Ok(mtime) = meta.modified() {
            newest_mtime = match newest_mtime {
                Some(prev) if prev >= mtime => Some(prev),
                _ => Some(mtime),
            };
        }
    }

    (total_bytes, newest_mtime)
}

/// Escáner Inteligente de Apps Inactivas:
/// Recorre hasta profundidad máxima 3 dentro de los directorios raíz (`%LOCALAPPDATA%` y `%APPDATA%`)
/// buscando únicamente carpetas con nombre exacto de caché (`Cache`, `Caches`, `Cache_Data`,
/// `Code Cache`, `GPUCache`, `DawnCache`, `ShaderCache`) que no hayan sido cubiertas por otras reglas,
/// pesen al menos `min_bytes` y cuyo archivo más reciente supere `inactive_days_threshold` días.
pub fn discover_inactive_app_caches_in_roots(
    roots: &[&Path],
    excluded_paths: &[PathBuf],
    inactive_days_threshold: u32,
    min_bytes: u64,
    now: SystemTime,
) -> Vec<CacheRuleSpec> {
    let excluded_norm: Vec<String> = excluded_paths
        .iter()
        .map(|p| normalize_path_lower(p))
        .collect();
    let threshold_secs = u64::from(inactive_days_threshold) * 86_400;

    let mut discovered_rules = Vec::new();
    let mut seen_dirs: HashSet<String> = HashSet::new();

    for &root in roots {
        if !root.is_dir() {
            continue;
        }
        let Ok(top_entries) = std::fs::read_dir(root) else {
            continue;
        };

        for top_entry in top_entries.flatten() {
            let app_root = top_entry.path();
            if !app_root.is_dir() {
                continue;
            }
            let Some(app_folder_name) = app_root.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let app_lower = app_folder_name.to_ascii_lowercase();
            if app_folder_name.len() < 3
                || INACTIVE_SCAN_EXCLUDED_TOP_DIRS.contains(&app_lower.as_str())
            {
                continue;
            }

            // Recorre profundidades 1..=3 relativas a `root` (equivale a profundidad 1..=2 dentro de `app_root`)
            let mut candidate_dirs: Vec<PathBuf> = Vec::new();
            for entry in WalkDir::new(&app_root)
                .min_depth(1)
                .max_depth(2)
                .follow_links(false)
                .skip_hidden(false)
            {
                let Ok(item) = entry else {
                    continue;
                };
                if !item.file_type().is_dir() {
                    continue;
                }
                let dir_name = item.file_name().to_string_lossy().to_ascii_lowercase();
                if INACTIVE_APP_CACHE_DIR_NAMES.contains(&dir_name.as_str()) {
                    candidate_dirs.push(item.path());
                }
            }

            // Evitar duplicar padre e hijo (ej. `Cache` y `Cache\Cache_Data`): preferir la carpeta más externa
            candidate_dirs.sort_by_key(|p| p.components().count());
            let mut filtered_dirs: Vec<PathBuf> = Vec::new();
            for cand in candidate_dirs {
                let cand_norm = normalize_path_lower(&cand);
                if security::is_protected_path(&cand) {
                    continue;
                }
                let already_covered = excluded_norm.iter().any(|ex| {
                    cand_norm == *ex
                        || cand_norm.starts_with(&format!("{ex}\\"))
                        || ex.starts_with(&format!("{cand_norm}\\"))
                });
                if already_covered {
                    continue;
                }
                let is_child_of_selected = filtered_dirs.iter().any(|parent| {
                    let pnorm = normalize_path_lower(parent);
                    cand_norm.starts_with(&format!("{pnorm}\\"))
                });
                if is_child_of_selected || seen_dirs.contains(&cand_norm) {
                    continue;
                }
                seen_dirs.insert(cand_norm);
                filtered_dirs.push(cand);
            }

            for cache_dir in filtered_dirs {
                let (size_bytes, newest_mtime) = measure_cache_dir_age_and_size(&cache_dir);
                if size_bytes < min_bytes {
                    continue;
                }
                let Some(newest) = newest_mtime else {
                    continue;
                };
                let Ok(age) = now.duration_since(newest) else {
                    continue;
                };
                if age < Duration::from_secs(threshold_secs) {
                    continue;
                }

                let days_inactive = age.as_secs() / 86_400;
                let sub_label = cache_dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Cache");
                let slug = normalize_path_lower(&cache_dir)
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
                    .collect::<String>();

                discovered_rules.push(CacheRuleSpec {
                    id: format!("inactive_cache_{slug}"),
                    group: CacheGroup::InactiveApps,
                    name: format!(
                        "Caché inactiva: {app_folder_name} (sin actividad hace {days_inactive} días)"
                    ),
                    description: format!(
                        "Carpeta temporal '{sub_label}' sin cambios desde hace más de {inactive_days_threshold} días; seguro de limpiar."
                    ),
                    safety: SafetyLevel::Safe,
                    requires_admin: false,
                    paths: vec![cache_dir],
                    process_names: Vec::new(),
                    skip_recent_minutes: None,
                    file_prefix_filter: None,
                    service_to_pause: None,
                    direct_delete_only: false,
                    precomputed_inactive_days: Some(days_inactive),
                });
            }
        }
    }

    discovered_rules
}

/// Construye el catálogo completo de reglas de limpieza para los 5 grupos del Paso 5.
pub fn build_all_cache_rules(inactive_days_threshold: u32) -> Vec<CacheRuleSpec> {
    let mut rules = Vec::new();

    let local_appdata = dirs::data_local_dir();
    let roaming_appdata = dirs::config_dir();
    let user_temp = std::env::temp_dir();
    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
    let win_dir = PathBuf::from(
        std::env::var("SystemRoot").unwrap_or_else(|_| format!(r"{system_drive}\Windows")),
    );
    let programdata = PathBuf::from(
        std::env::var("ProgramData").unwrap_or_else(|_| format!(r"{system_drive}\ProgramData")),
    );
    let program_files_x86 = PathBuf::from(
        std::env::var("ProgramFiles(x86)")
            .unwrap_or_else(|_| format!(r"{system_drive}\Program Files (x86)")),
    );

    // =========================================================================
    // 1. SISTEMA WINDOWS (WindowsSystem) — SIN Prefetch ni limpiadores de Registro
    // =========================================================================
    rules.push(CacheRuleSpec {
        id: "win_user_temp".to_string(),
        group: CacheGroup::WindowsSystem,
        name: "Archivos temporales de tu usuario".to_string(),
        description:
            "Archivos de trabajo temporales creados por programas; se omiten los modificados en los últimos 5 minutos."
                .to_string(),
        safety: SafetyLevel::Safe,
        requires_admin: false,
        paths: vec![user_temp],
        process_names: Vec::new(),
        skip_recent_minutes: Some(5),
        file_prefix_filter: None,
        service_to_pause: None,
        direct_delete_only: false,
        precomputed_inactive_days: None,
    });

    rules.push(CacheRuleSpec {
        id: "win_system_temp".to_string(),
        group: CacheGroup::WindowsSystem,
        name: "Archivos temporales del sistema".to_string(),
        description:
            "Temporales generales de Windows acumulados por instaladores y servicios del equipo."
                .to_string(),
        safety: SafetyLevel::Safe,
        requires_admin: true,
        paths: vec![win_dir.join("Temp")],
        process_names: Vec::new(),
        skip_recent_minutes: Some(5),
        file_prefix_filter: None,
        service_to_pause: None,
        direct_delete_only: true,
        precomputed_inactive_days: None,
    });

    rules.push(CacheRuleSpec {
        id: "win_update_cache".to_string(),
        group: CacheGroup::WindowsSystem,
        name: "Caché de Windows Update".to_string(),
        description:
            "Instaladores de actualizaciones ya descargadas; Windows los vuelve a bajar si los necesita."
                .to_string(),
        safety: SafetyLevel::Safe,
        requires_admin: true,
        paths: vec![win_dir.join("SoftwareDistribution").join("Download")],
        process_names: Vec::new(),
        skip_recent_minutes: None,
        file_prefix_filter: None,
        service_to_pause: Some("wuauserv".to_string()),
        direct_delete_only: true,
        precomputed_inactive_days: None,
    });

    rules.push(CacheRuleSpec {
        id: "win_delivery_opt".to_string(),
        group: CacheGroup::WindowsSystem,
        name: "Optimización de entrega de Windows".to_string(),
        description:
            "Fragmentos de actualizaciones guardados para compartir en red; es seguro liberarlos."
                .to_string(),
        safety: SafetyLevel::Safe,
        requires_admin: true,
        paths: vec![
            win_dir
                .join("ServiceProfiles")
                .join("NetworkService")
                .join("AppData")
                .join("Local")
                .join("Microsoft")
                .join("Windows")
                .join("DeliveryOptimization")
                .join("Cache"),
            win_dir
                .join("SoftwareDistribution")
                .join("DeliveryOptimization"),
        ],
        process_names: Vec::new(),
        skip_recent_minutes: None,
        file_prefix_filter: None,
        service_to_pause: None,
        direct_delete_only: true,
        precomputed_inactive_days: None,
    });

    if let Some(ref local) = local_appdata {
        rules.push(CacheRuleSpec {
            id: "win_thumbnails".to_string(),
            group: CacheGroup::WindowsSystem,
            name: "Caché de miniaturas del Explorador".to_string(),
            description:
                "Vistas previas de fotos y videos; Windows las reconstruirá la próxima vez que abras tus carpetas."
                    .to_string(),
            safety: SafetyLevel::Review,
            requires_admin: false,
            paths: vec![local.join("Microsoft").join("Windows").join("Explorer")],
            process_names: Vec::new(),
            skip_recent_minutes: None,
            file_prefix_filter: Some("thumbcache_".to_string()),
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });

        rules.push(CacheRuleSpec {
            id: "win_wer_user".to_string(),
            group: CacheGroup::WindowsSystem,
            name: "Informes de errores de Windows (Usuario)".to_string(),
            description:
                "Reportes antiguos de cierres inesperados de programas que ya no son necesarios."
                    .to_string(),
            safety: SafetyLevel::Safe,
            requires_admin: false,
            paths: vec![local.join("Microsoft").join("Windows").join("WER")],
            process_names: Vec::new(),
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });
    }

    rules.push(CacheRuleSpec {
        id: "win_wer_system".to_string(),
        group: CacheGroup::WindowsSystem,
        name: "Informes de errores de Windows (Sistema)".to_string(),
        description:
            "Registros de diagnóstico de errores de Windows almacenados en ProgramData."
                .to_string(),
        safety: SafetyLevel::Safe,
        requires_admin: true,
        paths: vec![
            programdata
                .join("Microsoft")
                .join("Windows")
                .join("WER")
                .join("ReportArchive"),
            programdata
                .join("Microsoft")
                .join("Windows")
                .join("WER")
                .join("ReportQueue"),
        ],
        process_names: Vec::new(),
        skip_recent_minutes: None,
        file_prefix_filter: None,
        service_to_pause: None,
        direct_delete_only: true,
        precomputed_inactive_days: None,
    });

    // =========================================================================
    // 2. NAVEGADORES WEB (Browsers) — BLINDAJE ESTRICTO DE PRIVACIDAD
    // =========================================================================
    let browser_desc = "Copias temporales de páginas web; borrarlo NO elimina contraseñas, sesiones ni favoritos.";

    if let Some(ref local) = local_appdata {
        let chrome_paths =
            discover_chromium_cache_paths(&local.join("Google").join("Chrome").join("User Data"));
        if !chrome_paths.is_empty() {
            rules.push(CacheRuleSpec {
                id: "browser_chrome".to_string(),
                group: CacheGroup::Browsers,
                name: "Caché de Google Chrome".to_string(),
                description: browser_desc.to_string(),
                safety: SafetyLevel::Safe,
                requires_admin: false,
                paths: chrome_paths,
                process_names: vec!["chrome.exe".to_string()],
                skip_recent_minutes: None,
                file_prefix_filter: None,
                service_to_pause: None,
                direct_delete_only: false,
                precomputed_inactive_days: None,
            });
        }

        let edge_paths =
            discover_chromium_cache_paths(&local.join("Microsoft").join("Edge").join("User Data"));
        if !edge_paths.is_empty() {
            rules.push(CacheRuleSpec {
                id: "browser_edge".to_string(),
                group: CacheGroup::Browsers,
                name: "Caché de Microsoft Edge".to_string(),
                description: browser_desc.to_string(),
                safety: SafetyLevel::Safe,
                requires_admin: false,
                paths: edge_paths,
                process_names: vec!["msedge.exe".to_string()],
                skip_recent_minutes: None,
                file_prefix_filter: None,
                service_to_pause: None,
                direct_delete_only: false,
                precomputed_inactive_days: None,
            });
        }

        let brave_paths = discover_chromium_cache_paths(
            &local
                .join("BraveSoftware")
                .join("Brave-Browser")
                .join("User Data"),
        );
        if !brave_paths.is_empty() {
            rules.push(CacheRuleSpec {
                id: "browser_brave".to_string(),
                group: CacheGroup::Browsers,
                name: "Caché de Brave".to_string(),
                description: browser_desc.to_string(),
                safety: SafetyLevel::Safe,
                requires_admin: false,
                paths: brave_paths,
                process_names: vec!["brave.exe".to_string()],
                skip_recent_minutes: None,
                file_prefix_filter: None,
                service_to_pause: None,
                direct_delete_only: false,
                precomputed_inactive_days: None,
            });
        }

        let mut opera_paths =
            discover_opera_cache_paths(&local.join("Opera Software").join("Opera Stable"));
        opera_paths.extend(discover_opera_cache_paths(
            &local.join("Opera Software").join("Opera GX Stable"),
        ));
        if !opera_paths.is_empty() {
            rules.push(CacheRuleSpec {
                id: "browser_opera".to_string(),
                group: CacheGroup::Browsers,
                name: "Caché de Opera / Opera GX".to_string(),
                description: browser_desc.to_string(),
                safety: SafetyLevel::Safe,
                requires_admin: false,
                paths: opera_paths,
                process_names: vec!["opera.exe".to_string()],
                skip_recent_minutes: None,
                file_prefix_filter: None,
                service_to_pause: None,
                direct_delete_only: false,
                precomputed_inactive_days: None,
            });
        }

        let firefox_paths =
            discover_firefox_cache_paths(&local.join("Mozilla").join("Firefox").join("Profiles"));
        if !firefox_paths.is_empty() {
            rules.push(CacheRuleSpec {
                id: "browser_firefox".to_string(),
                group: CacheGroup::Browsers,
                name: "Caché de Mozilla Firefox".to_string(),
                description: browser_desc.to_string(),
                safety: SafetyLevel::Safe,
                requires_admin: false,
                paths: firefox_paths,
                process_names: vec!["firefox.exe".to_string()],
                skip_recent_minutes: None,
                file_prefix_filter: None,
                service_to_pause: None,
                direct_delete_only: false,
                precomputed_inactive_days: None,
            });
        }
    }

    // =========================================================================
    // 3. CACHÉ DE SHADERS GRÁFICOS (GraphicsShaders) — Review (desmarcado por defecto)
    // =========================================================================
    let shader_desc = "Archivos gráficos compilados para juegos; liberan bastante espacio, pero tus juegos tardarán unos segundos extra la próxima vez que inicien.";
    if let Some(ref local) = local_appdata {
        rules.push(CacheRuleSpec {
            id: "shader_directx".to_string(),
            group: CacheGroup::GraphicsShaders,
            name: "DirectX Shader Cache".to_string(),
            description: shader_desc.to_string(),
            safety: SafetyLevel::Review,
            requires_admin: false,
            paths: vec![local.join("D3DSCache")],
            process_names: Vec::new(),
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });

        rules.push(CacheRuleSpec {
            id: "shader_amd".to_string(),
            group: CacheGroup::GraphicsShaders,
            name: "AMD Shader Cache".to_string(),
            description: shader_desc.to_string(),
            safety: SafetyLevel::Review,
            requires_admin: false,
            paths: vec![
                local.join("AMD").join("DxCache"),
                local.join("AMD").join("GLCache"),
                local.join("AMD").join("VkCache"),
            ],
            process_names: Vec::new(),
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });

        rules.push(CacheRuleSpec {
            id: "shader_nvidia".to_string(),
            group: CacheGroup::GraphicsShaders,
            name: "NVIDIA Shader Cache".to_string(),
            description: shader_desc.to_string(),
            safety: SafetyLevel::Review,
            requires_admin: false,
            paths: vec![
                local.join("NVIDIA").join("DXCache"),
                local.join("NVIDIA").join("GLCache"),
            ],
            process_names: Vec::new(),
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });
    }

    // =========================================================================
    // 4. APLICACIONES DE TERCEROS Y CACHÉS INACTIVAS (InactiveApps)
    // =========================================================================
    if let Some(ref roaming) = roaming_appdata {
        rules.push(CacheRuleSpec {
            id: "app_cache_discord".to_string(),
            group: CacheGroup::InactiveApps,
            name: "Caché de Discord".to_string(),
            description:
                "Imágenes, videos y caché web descargados en chats; no borra tu cuenta ni mensajes."
                    .to_string(),
            safety: SafetyLevel::Safe,
            requires_admin: false,
            paths: vec![
                roaming.join("discord").join("Cache").join("Cache_Data"),
                roaming.join("discord").join("Code Cache"),
                roaming.join("discord").join("GPUCache"),
            ],
            process_names: vec!["discord.exe".to_string()],
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });

        rules.push(CacheRuleSpec {
            id: "app_cache_slack".to_string(),
            group: CacheGroup::InactiveApps,
            name: "Caché de Slack".to_string(),
            description:
                "Archivos temporales de interfaz e imágenes de canales; tu sesión permanece intacta."
                    .to_string(),
            safety: SafetyLevel::Safe,
            requires_admin: false,
            paths: vec![
                roaming.join("Slack").join("Cache").join("Cache_Data"),
                roaming.join("Slack").join("Code Cache"),
                roaming.join("Slack").join("GPUCache"),
            ],
            process_names: vec!["slack.exe".to_string()],
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });

        rules.push(CacheRuleSpec {
            id: "app_cache_vscode".to_string(),
            group: CacheGroup::InactiveApps,
            name: "Caché de Visual Studio Code".to_string(),
            description:
                "Caché interna de la interfaz y datos compilados; no toca proyectos ni ajustes."
                    .to_string(),
            safety: SafetyLevel::Safe,
            requires_admin: false,
            paths: vec![
                roaming.join("Code").join("Cache").join("Cache_Data"),
                roaming.join("Code").join("Code Cache"),
                roaming.join("Code").join("CachedData"),
                roaming.join("Code").join("GPUCache"),
            ],
            process_names: vec!["code.exe".to_string()],
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });

        let mut teams_paths = vec![
            roaming.join("Microsoft").join("Teams").join("Cache"),
            roaming.join("Microsoft").join("Teams").join("Code Cache"),
            roaming.join("Microsoft").join("Teams").join("GPUCache"),
        ];
        if let Some(ref local) = local_appdata {
            teams_paths.push(
                local
                    .join("Packages")
                    .join("MSTeams_8wekyb3d8bbwe")
                    .join("LocalCache")
                    .join("Microsoft")
                    .join("MSTeams")
                    .join("EBWebView")
                    .join("Default")
                    .join("Cache")
                    .join("Cache_Data"),
            );
        }
        rules.push(CacheRuleSpec {
            id: "app_cache_teams".to_string(),
            group: CacheGroup::InactiveApps,
            name: "Caché de Microsoft Teams".to_string(),
            description:
                "Temporales de chats y reuniones; no elimina conversaciones ni archivos en la nube."
                    .to_string(),
            safety: SafetyLevel::Safe,
            requires_admin: false,
            paths: teams_paths,
            process_names: vec!["ms-teams.exe".to_string(), "teams.exe".to_string()],
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });
    }

    if let Some(ref local) = local_appdata {
        rules.push(CacheRuleSpec {
            id: "app_cache_spotify".to_string(),
            group: CacheGroup::InactiveApps,
            name: "Caché de música de Spotify".to_string(),
            description:
                "Canciones y carátulas almacenadas en caché; volverán a descargarse al escucharlas."
                    .to_string(),
            safety: SafetyLevel::Review,
            requires_admin: false,
            paths: vec![
                local.join("Spotify").join("Data"),
                local.join("Spotify").join("Storage"),
            ],
            process_names: vec!["spotify.exe".to_string()],
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });

        rules.push(CacheRuleSpec {
            id: "app_cache_steam".to_string(),
            group: CacheGroup::InactiveApps,
            name: "Caché web de Steam".to_string(),
            description:
                "Imágenes y páginas de la tienda de Steam; nunca toca tus juegos instalados ni partidas."
                    .to_string(),
            safety: SafetyLevel::Safe,
            requires_admin: false,
            paths: vec![
                program_files_x86
                    .join("Steam")
                    .join("appcache")
                    .join("httpcache"),
                local.join("Steam").join("htmlcache").join("Cache"),
            ],
            process_names: vec!["steam.exe".to_string()],
            skip_recent_minutes: None,
            file_prefix_filter: None,
            service_to_pause: None,
            direct_delete_only: false,
            precomputed_inactive_days: None,
        });
    }

    // Escáner Inteligente de Apps Inactivas (profundidad máx. 3 en %LOCALAPPDATA% y %APPDATA%)
    let covered_paths: Vec<PathBuf> = rules.iter().flat_map(|r| r.paths.iter().cloned()).collect();
    let mut scan_roots: Vec<&Path> = Vec::new();
    if let Some(ref local) = local_appdata {
        scan_roots.push(local.as_path());
    }
    if let Some(ref roaming) = roaming_appdata {
        scan_roots.push(roaming.as_path());
    }
    let inactive_rules = discover_inactive_app_caches_in_roots(
        &scan_roots,
        &covered_paths,
        inactive_days_threshold,
        INACTIVE_APP_MIN_BYTES,
        SystemTime::now(),
    );
    rules.extend(inactive_rules);

    // =========================================================================
    // 5. PAPELERA DE RECICLAJE (RecycleBin) — Review (desmarcada por defecto)
    // =========================================================================
    rules.push(CacheRuleSpec {
        id: "recycle_bin".to_string(),
        group: CacheGroup::RecycleBin,
        name: "Papelera de Reciclaje de Windows".to_string(),
        description:
            "Archivos que borraste anteriormente; vaciarla libera espacio de forma permanente."
                .to_string(),
        safety: SafetyLevel::Review,
        requires_admin: false,
        paths: Vec::new(),
        process_names: Vec::new(),
        skip_recent_minutes: None,
        file_prefix_filter: None,
        service_to_pause: None,
        direct_delete_only: true,
        precomputed_inactive_days: None,
    });

    rules
}

#[cfg(test)]
mod tests {
    use super::{
        build_all_cache_rules, compute_default_selected, discover_chromium_cache_paths,
        discover_firefox_cache_paths, discover_inactive_app_caches_in_roots,
        is_cleaner_target_path_safe, is_safe_browser_cache_path, CacheGroup, SafetyLevel,
    };
    use filetime::{set_file_mtime, FileTime};
    use std::fs;
    use std::path::Path;
    use std::time::{Duration, SystemTime};

    /// Prueba obligatoria 1: Blindaje de navegadores (Chrome/Edge/Brave/Firefox).
    #[test]
    fn blindaje_de_navegadores_nunca_incluye_datos_personales() {
        let temp_base = std::env::temp_dir().join(format!(
            "diskvault_browser_shield_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_base);

        let chrome_profile = temp_base.join("ChromeUserData").join("Default");
        fs::create_dir_all(chrome_profile.join(r"Cache\Cache_Data")).unwrap();
        fs::create_dir_all(chrome_profile.join("Code Cache")).unwrap();
        fs::create_dir_all(chrome_profile.join("GPUCache")).unwrap();
        fs::create_dir_all(chrome_profile.join("Local Storage")).unwrap();
        fs::create_dir_all(chrome_profile.join("Extensions")).unwrap();
        fs::write(chrome_profile.join("Cookies"), b"secret").unwrap();
        fs::write(chrome_profile.join("Login Data"), b"secret").unwrap();
        fs::write(chrome_profile.join("Bookmarks"), b"secret").unwrap();
        fs::write(chrome_profile.join("History"), b"secret").unwrap();
        fs::write(chrome_profile.join("Web Data"), b"secret").unwrap();

        let ff_profile = temp_base.join("FirefoxProfiles").join("abc123.default-release");
        fs::create_dir_all(ff_profile.join("cache2")).unwrap();
        fs::write(ff_profile.join("places.sqlite"), b"secret").unwrap();
        fs::write(ff_profile.join("logins.json"), b"secret").unwrap();

        let chromium_paths = discover_chromium_cache_paths(&temp_base.join("ChromeUserData"));
        let firefox_paths = discover_firefox_cache_paths(&temp_base.join("FirefoxProfiles"));

        assert_eq!(chromium_paths.len(), 3);
        assert_eq!(firefox_paths.len(), 1);

        for path in chromium_paths.iter().chain(firefox_paths.iter()) {
            assert!(is_safe_browser_cache_path(path));
            let lower = path.to_string_lossy().to_ascii_lowercase();
            for sensitive in [
                "cookies",
                "login data",
                "bookmarks",
                "history",
                "places.sqlite",
                "web data",
                "local storage",
                "extensions",
            ] {
                assert!(
                    !lower.contains(sensitive),
                    "Fallo de blindaje: '{}' contiene '{sensitive}'",
                    path.display()
                );
            }
        }

        assert!(!is_safe_browser_cache_path(Path::new(
            r"C:\Users\Test\AppData\Local\Google\Chrome\User Data\Default\Cookies"
        )));
        assert!(!is_safe_browser_cache_path(Path::new(
            r"C:\Users\Test\AppData\Local\Mozilla\Firefox\Profiles\abc.default\places.sqlite"
        )));

        let _ = fs::remove_dir_all(&temp_base);
    }

    /// Prueba obligatoria 2: Validación de protección del sistema y whitelist explícita.
    #[test]
    fn validacion_de_proteccion_del_sistema_y_exclusion_prefetch() {
        assert!(!is_cleaner_target_path_safe(
            Path::new(r"C:\Windows"),
            CacheGroup::WindowsSystem
        ));
        assert!(!is_cleaner_target_path_safe(
            Path::new(r"C:\Windows\System32"),
            CacheGroup::WindowsSystem
        ));
        assert!(!is_cleaner_target_path_safe(
            Path::new(r"C:\Windows\Prefetch"),
            CacheGroup::WindowsSystem
        ));
        assert!(is_cleaner_target_path_safe(
            Path::new(r"C:\Windows\Temp"),
            CacheGroup::WindowsSystem
        ));
        assert!(is_cleaner_target_path_safe(
            Path::new(r"C:\Windows\SoftwareDistribution\Download"),
            CacheGroup::WindowsSystem
        ));

        let rules = build_all_cache_rules(30);
        for rule in &rules {
            for p in &rule.paths {
                assert!(!p.to_string_lossy().to_ascii_lowercase().contains("prefetch"));
            }
        }

        assert!(compute_default_selected(SafetyLevel::Safe, false, false));
        assert!(!compute_default_selected(SafetyLevel::Safe, true, false));
        assert!(!compute_default_selected(SafetyLevel::Review, false, true));
    }

    /// Prueba obligatoria 3: Detector de caché inactiva (45 días vs hoy con umbral de 30 días).
    #[test]
    fn detector_de_cache_inactiva_solo_selecciona_la_antigua() {
        let root = std::env::temp_dir().join(format!(
            "diskvault_inactive_detector_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);

        let old_cache = root.join("MiAppOlvidada").join("Cache");
        let fresh_cache = root.join("MiAppActiva").join("Cache");
        fs::create_dir_all(&old_cache).unwrap();
        fs::create_dir_all(&fresh_cache).unwrap();

        let old_file = old_cache.join("data_antigua.bin");
        let fresh_file = fresh_cache.join("data_hoy.bin");
        fs::write(&old_file, vec![b'x'; 16_384]).unwrap();
        fs::write(&fresh_file, vec![b'y'; 16_384]).unwrap();

        let forty_five_days_ago = SystemTime::now() - Duration::from_secs(45 * 86_400);
        set_file_mtime(&old_file, FileTime::from_system_time(forty_five_days_ago)).unwrap();

        let detected = discover_inactive_app_caches_in_roots(
            &[root.as_path()],
            &[],
            30,
            1024, // umbral mínimo de tamaño para la prueba unitaria
            SystemTime::now(),
        );

        assert_eq!(detected.len(), 1);
        assert!(detected[0].name.contains("MiAppOlvidada"));
        assert_eq!(detected[0].safety, SafetyLevel::Safe);
        assert!(detected[0].precomputed_inactive_days.unwrap_or(0) >= 44);

        let _ = fs::remove_dir_all(&root);
    }
}
