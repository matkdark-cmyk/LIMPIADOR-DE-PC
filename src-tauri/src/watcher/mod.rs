use crate::mover::pipeline::MoverState;
use crate::storage::db::NasTarget;
use crate::storage::settings::AppSettings;
use crate::AppState;
use jwalk::WalkDir;
use notify::event::ModifyKind;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
const APP_USER_MODEL_ID: &str = "cl.diskvault.clean";

static EVENT_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Evento emitido cuando se detecta un archivo o carpeta nueva descargada o copiada al PC.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingFileEvent {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub origin_label: String,
    pub is_dir: bool,
    pub files_count: u64,
    pub total_bytes: u64,
    pub detected_at: String,
    pub available_targets_count: usize,
    pub is_test: bool,
}

/// Evento emitido cuando el usuario interactúa con la notificación nativa de Windows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingFileActionEvent {
    pub id: String,
    pub action: String,
}

/// Información de una carpeta monitoreada para mostrar en Ajustes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolderEntry {
    pub label: String,
    pub path: String,
    pub is_default: bool,
    pub exists: bool,
}

/// Resumen del estado actual del detector de archivos nuevos.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFoldersInfo {
    pub enabled: bool,
    pub min_size_mb: u32,
    pub folders: Vec<WatchedFolderEntry>,
}

/// Configuración activa en memoria del monitor de archivos entrantes.
#[derive(Debug, Clone)]
pub struct WatcherRuntimeConfig {
    pub enabled: bool,
    pub min_size_mb: u32,
    pub extra_folders: Vec<String>,
}

impl From<&AppSettings> for WatcherRuntimeConfig {
    fn from(settings: &AppSettings) -> Self {
        Self {
            enabled: settings.watch_incoming_files,
            min_size_mb: settings.watch_min_size_mb,
            extra_folders: settings.watched_extra_folders.clone(),
        }
    }
}

/// Estado administrado por Tauri para el monitor de archivos descargados o copiados.
pub struct WatcherState {
    pub config: Arc<RwLock<WatcherRuntimeConfig>>,
    pub reload_flag: Arc<AtomicBool>,
    pub recent_events: Arc<Mutex<Vec<IncomingFileEvent>>>,
}

impl WatcherState {
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            config: Arc::new(RwLock::new(WatcherRuntimeConfig::from(settings))),
            reload_flag: Arc::new(AtomicBool::new(false)),
            recent_events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn update_from_settings(&self, settings: &AppSettings) {
        if let Ok(mut guard) = self.config.write() {
            *guard = WatcherRuntimeConfig::from(settings);
        }
        self.reload_flag.store(true, Ordering::SeqCst);
    }

    pub fn push_recent_event(&self, event: IncomingFileEvent) {
        if let Ok(mut guard) = self.recent_events.lock() {
            guard.retain(|item| item.id != event.id);
            guard.push(event);
            if guard.len() > 25 {
                let overflow = guard.len() - 25;
                guard.drain(0..overflow);
            }
        }
    }

    pub fn get_watched_folders_info(&self) -> WatchedFoldersInfo {
        let cfg = self
            .config
            .read()
            .map(|g| g.clone())
            .unwrap_or(WatcherRuntimeConfig {
                enabled: true,
                min_size_mb: 0,
                extra_folders: Vec::new(),
            });

        let folders = collect_watched_folders(&cfg.extra_folders);
        WatchedFoldersInfo {
            enabled: cfg.enabled,
            min_size_mb: cfg.min_size_mb,
            folders,
        }
    }
}

fn next_event_id() -> String {
    let seq = EVENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = chrono::Utc::now().timestamp_millis();
    format!("inc-{ts}-{seq}")
}

fn normalize_path_key(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// Construye la lista deduplicada de carpetas estándar de Windows + carpetas adicionales del usuario.
pub fn collect_watched_folders(extra_folders: &[String]) -> Vec<WatchedFolderEntry> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();

    let defaults: [(&str, Option<PathBuf>); 5] = [
        ("Descargas", dirs::download_dir()),
        ("Escritorio", dirs::desktop_dir()),
        ("Documentos", dirs::document_dir()),
        ("Vídeos", dirs::video_dir()),
        ("Imágenes", dirs::picture_dir()),
    ];

    for (label, opt_path) in defaults {
        if let Some(dir) = opt_path {
            let key = normalize_path_key(&dir);
            if !key.is_empty() && seen.insert(key) {
                let exists = dir.is_dir();
                entries.push(WatchedFolderEntry {
                    label: label.to_string(),
                    path: dir.to_string_lossy().to_string(),
                    is_default: true,
                    exists,
                });
            }
        }
    }

    for raw in extra_folders {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let dir = PathBuf::from(trimmed);
        let key = normalize_path_key(&dir);
        if !key.is_empty() && seen.insert(key) {
            let label = dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Carpeta vigilada".to_string());
            let exists = dir.is_dir();
            entries.push(WatchedFolderEntry {
                label,
                path: dir.to_string_lossy().to_string(),
                is_default: false,
                exists,
            });
        }
    }

    entries
}

/// Filtra archivos temporales de descargas incompletas, metadatos de Windows o archivos ocultos.
pub fn is_ignored_incoming_path(path: &Path) -> bool {
    let Some(file_name_os) = path.file_name() else {
        return true;
    };
    let file_name = file_name_os.to_string_lossy();
    let lower = file_name.trim().to_ascii_lowercase();

    if lower.is_empty()
        || lower.starts_with('.')
        || lower.starts_with("~$")
        || lower.starts_with("~wrl")
    {
        return true;
    }

    const IGNORED_EXACT_NAMES: &[&str] = &[
        "desktop.ini",
        "thumbs.db",
        ".ds_store",
        "ntuser.dat",
        "iconcache.db",
        "folder.jpg",
    ];
    if IGNORED_EXACT_NAMES.contains(&lower.as_str()) {
        return true;
    }

    const IGNORED_EXTENSIONS: &[&str] = &[
        "crdownload",
        "part",
        "tmp",
        "temp",
        "download",
        "opdownload",
        "partial",
        "!ut",
        "aria2",
        "filepart",
        "bak",
        "swp",
        "swx",
        "lnk",
        "url",
        "ini",
        "log",
        "lock",
        "lck",
    ];

    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_ascii_lowercase();
        if IGNORED_EXTENSIONS.contains(&ext_lower.as_str()) {
            return true;
        }
    }

    false
}

/// Comprueba si `candidate` cae dentro de (o coincide con) alguna ruta excluida (ej. destinos NAS o datos propios).
pub fn is_inside_excluded_root(candidate: &Path, excluded_roots: &[PathBuf]) -> bool {
    let cand_norm = normalize_path_key(candidate);
    if cand_norm.is_empty() {
        return true;
    }
    excluded_roots.iter().any(|root| {
        let root_norm = normalize_path_key(root);
        if root_norm.is_empty() {
            return false;
        }
        if cand_norm == root_norm {
            return true;
        }
        let prefix = if root_norm.ends_with('\\') {
            root_norm
        } else {
            format!("{root_norm}\\")
        };
        cand_norm.starts_with(&prefix)
    })
}

/// Formatea bytes de forma legible para el texto de la notificación nativa de Windows.
pub fn format_bytes_short(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    const TB: f64 = GB * 1024.0;

    let val = bytes as f64;
    if val >= TB {
        format!("{:.2} TB", val / TB)
    } else if val >= GB {
        format!("{:.2} GB", val / GB)
    } else if val >= MB {
        format!("{:.1} MB", val / MB)
    } else if val >= KB {
        format!("{:.0} KB", val / KB)
    } else {
        format!("{bytes} B")
    }
}

/// Registra el AppUserModelID en `HKCU\Software\Classes\AppUserModelId\cl.diskvault.clean`
/// únicamente en Modo Instalado para que el Centro de Notificaciones de Windows muestre "DiskVault Clean".
#[cfg(windows)]
fn register_windows_aumid_if_installed(is_portable: bool) {
    if is_portable {
        return;
    }
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key_path = format!(r"Software\Classes\AppUserModelId\{APP_USER_MODEL_ID}");
    if let Ok((key, _)) = hkcu.create_subkey(&key_path) {
        let _ = key.set_value("DisplayName", &"DiskVault Clean");
        if let Ok(exe_path) = std::env::current_exe() {
            let icon_uri = exe_path.to_string_lossy().to_string();
            let _ = key.set_value("IconUri", &icon_uri);
        }
    }
}

#[cfg(not(windows))]
fn register_windows_aumid_if_installed(_is_portable: bool) {}

fn build_notification_copy(
    event: &IncomingFileEvent,
    targets: &[NasTarget],
) -> (String, String, String) {
    let title = if event.is_dir {
        "Nueva carpeta detectada — DiskVault Clean".to_string()
    } else {
        "Nuevo archivo detectado — DiskVault Clean".to_string()
    };

    let size_label = format_bytes_short(event.total_bytes);
    let line1 = if event.is_dir && event.files_count > 0 {
        format!(
            "{} ({} archivo(s) · {}) en {}",
            event.file_name, event.files_count, size_label, event.origin_label
        )
    } else {
        format!(
            "{} ({}) en {}",
            event.file_name, size_label, event.origin_label
        )
    };

    let line2 = if targets.is_empty() {
        "¿Quieres copiarlo directamente a tu NAS / disco de respaldo o dejarlo solo en este PC?"
            .to_string()
    } else {
        let names: Vec<String> = targets.iter().take(2).map(|t| t.name.clone()).collect();
        let extra = targets.len().saturating_sub(2);
        let list_str = if extra > 0 {
            format!("{} (+{} más)", names.join(", "), extra)
        } else {
            names.join(", ")
        };
        format!("¿Copiar al NAS ({list_str}) o dejar solo en este PC?")
    };

    (title, line1, line2)
}

#[cfg(windows)]
fn focus_main_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Envía una notificación nativa interactiva al Centro de Notificaciones de Windows (WinRT Toast)
/// con botones "Copiar al NAS" y "Solo dejar en PC".
#[cfg(windows)]
pub fn send_windows_incoming_notification(
    app_handle: &AppHandle,
    event: &IncomingFileEvent,
    targets: &[NasTarget],
    is_portable: bool,
) -> Result<(), String> {
    use tauri_winrt_notification::{Duration as ToastDuration, Sound, Toast};

    let (title, line1, line2) = build_notification_copy(event, targets);
    let copy_action = format!("copy_nas:{}", event.id);
    let keep_action = format!("keep_pc:{}", event.id);

    let try_show = |app_id: &str| -> Result<(), String> {
        let handle = app_handle.clone();
        let event_id = event.id.clone();

        Toast::new(app_id)
            .title(&title)
            .text1(&line1)
            .text2(&line2)
            .duration(ToastDuration::Long)
            .sound(Some(Sound::Default))
            .add_button("Copiar al NAS", &copy_action)
            .add_button("Solo dejar en PC", &keep_action)
            .on_activated(move |action| {
                let is_keep_pc = action
                    .as_deref()
                    .map(|act| act.starts_with("keep_pc:"))
                    .unwrap_or(false);

                if is_keep_pc {
                    let _ = handle.emit(
                        "incoming-file-action",
                        IncomingFileActionEvent {
                            id: event_id.clone(),
                            action: "keep_pc".to_string(),
                        },
                    );
                } else {
                    focus_main_window(&handle);
                    let _ = handle.emit(
                        "incoming-file-action",
                        IncomingFileActionEvent {
                            id: event_id.clone(),
                            action: "open_modal".to_string(),
                        },
                    );
                }
                Ok(())
            })
            .show()
            .map_err(|err| format!("No se pudo mostrar la notificación de Windows: {err}"))
    };

    if !is_portable {
        if try_show(APP_USER_MODEL_ID).is_ok() {
            return Ok(());
        }
    }

    try_show(Toast::POWERSHELL_APP_ID)
}

#[cfg(not(windows))]
pub fn send_windows_incoming_notification(
    _app_handle: &AppHandle,
    _event: &IncomingFileEvent,
    _targets: &[NasTarget],
    _is_portable: bool,
) -> Result<(), String> {
    Ok(())
}

/// Dispara una notificación de prueba real en el Centro de Notificaciones de Windows para que
/// el usuario verifique el funcionamiento con 1 clic desde Ajustes.
pub fn trigger_test_incoming_notification(app_handle: &AppHandle) -> Result<IncomingFileEvent, String> {
    let app_state = app_handle.state::<AppState>();
    let watcher_state = app_handle.state::<WatcherState>();

    let targets = app_state.db.list_nas_targets().unwrap_or_default();
    let sample_dir = dirs::download_dir().unwrap_or_else(|| app_state.paths.data_dir.clone());
    let sample_path = sample_dir.join("Respaldo_Prueba_DiskVault.zip");

    let event = IncomingFileEvent {
        id: next_event_id(),
        path: sample_path.to_string_lossy().to_string(),
        file_name: "Respaldo_Prueba_DiskVault.zip".to_string(),
        origin_label: "Descargas (Prueba)".to_string(),
        is_dir: false,
        files_count: 1,
        total_bytes: 128 * 1024 * 1024,
        detected_at: chrono::Utc::now().to_rfc3339(),
        available_targets_count: targets.len(),
        is_test: true,
    };

    watcher_state.push_recent_event(event.clone());
    let _ = app_handle.emit("incoming-file-detected", event.clone());

    send_windows_incoming_notification(app_handle, &event, &targets, app_state.paths.is_portable)?;

    Ok(event)
}

#[derive(Debug, Clone)]
struct PendingCandidate {
    path: PathBuf,
    origin_label: String,
    last_change: Instant,
    last_size: u64,
    last_files_count: u64,
    stable_ticks: u32,
}

fn measure_candidate(path: &Path) -> Option<(bool, u64, u64, bool)> {
    let meta = fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() {
        return None;
    }

    if meta.is_file() {
        let size = meta.len();
        // Verifica que el archivo no tenga bloqueo exclusivo de escritura (copia/descarga activa)
        let readable = File::open(path).is_ok();
        return Some((false, 1, size, readable));
    }

    if meta.is_dir() {
        let mut files_count: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut readable = true;

        for entry in WalkDir::new(path).skip_hidden(false).into_iter().take(5_000) {
            let Ok(entry) = entry else { continue };
            if entry.file_type().is_file() {
                if let Ok(m) = entry.metadata() {
                    files_count = files_count.saturating_add(1);
                    total_bytes = total_bytes.saturating_add(m.len());
                }
            }
        }

        // Comprobar legibilidad de un archivo muestra si existe
        if files_count > 0 {
            if let Some(first_file) = WalkDir::new(path)
                .skip_hidden(false)
                .into_iter()
                .take(20)
                .flatten()
                .find(|e| e.file_type().is_file())
            {
                readable = File::open(first_file.path()).is_ok();
            }
        }

        return Some((true, files_count, total_bytes, readable));
    }

    None
}

fn resolve_watched_origin(
    candidate: &Path,
    watched_roots: &[(PathBuf, String)],
) -> Option<(PathBuf, String)> {
    let cand_norm = normalize_path_key(candidate);
    for (root, label) in watched_roots {
        let root_norm = normalize_path_key(root);
        let prefix = if root_norm.ends_with('\\') {
            root_norm.clone()
        } else {
            format!("{root_norm}\\")
        };

        if cand_norm.starts_with(&prefix) {
            // Eleva a la entrada de primer nivel dentro de la carpeta vigilada
            // para agrupar carpetas completas copiadas desde USB/discos en una sola notificación.
            if let Ok(rel) = candidate.strip_prefix(root) {
                if let Some(first_comp) = rel.components().next() {
                    let top_level = root.join(first_comp.as_os_str());
                    return Some((top_level, label.clone()));
                }
            }
            return Some((candidate.to_path_buf(), label.clone()));
        }
    }
    None
}

fn is_relevant_notify_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_))
    )
}

fn rebuild_watcher(
    tx: mpsc::Sender<notify::Result<Event>>,
    extra_folders: &[String],
) -> (Option<RecommendedWatcher>, Vec<(PathBuf, String)>) {
    let entries = collect_watched_folders(extra_folders);
    let mut active_roots = Vec::new();

    let Ok(mut watcher) = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default(),
    ) else {
        return (None, active_roots);
    };

    for entry in entries {
        if !entry.exists {
            continue;
        }
        let path = PathBuf::from(&entry.path);
        if watcher.watch(&path, RecursiveMode::NonRecursive).is_ok() {
            active_roots.push((path, entry.label));
        }
    }

    (Some(watcher), active_roots)
}

/// Inicia el hilo dedicado en segundo plano que vigila Descargas, Escritorio, Documentos,
/// Vídeos, Imágenes y carpetas personalizadas usando eventos nativos del sistema (`ReadDirectoryChangesW`).
pub fn spawn_incoming_file_watcher(app_handle: AppHandle) {
    let is_portable = app_handle.state::<AppState>().paths.is_portable;
    register_windows_aumid_if_installed(is_portable);

    let _ = thread::Builder::new()
        .name("diskvault-incoming-watcher".to_string())
        .spawn(move || {
            let (mut tx, mut rx) = mpsc::channel::<notify::Result<Event>>();
            let mut active_watcher: Option<RecommendedWatcher> = None;
            let mut watched_roots: Vec<(PathBuf, String)> = Vec::new();
            let mut pending: HashMap<String, PendingCandidate> = HashMap::new();
            let mut recently_notified: HashMap<String, Instant> = HashMap::new();

            // Primera inicialización según ajustes persistidos
            let mut last_enabled = {
                let watcher_state = app_handle.state::<WatcherState>();
                let cfg = watcher_state
                    .config
                    .read()
                    .map(|g| g.clone())
                    .unwrap_or(WatcherRuntimeConfig {
                        enabled: true,
                        min_size_mb: 0,
                        extra_folders: Vec::new(),
                    });
                if cfg.enabled {
                    let (w, roots) = rebuild_watcher(tx.clone(), &cfg.extra_folders);
                    active_watcher = w;
                    watched_roots = roots;
                }
                cfg.enabled
            };

            loop {
                // 1. Verificar si el usuario cambió ajustes de vigilancia
                let (cfg, should_reload) = {
                    let watcher_state = app_handle.state::<WatcherState>();
                    let reload = watcher_state.reload_flag.swap(false, Ordering::SeqCst);
                    let cfg = watcher_state
                        .config
                        .read()
                        .map(|g| g.clone())
                        .unwrap_or(WatcherRuntimeConfig {
                            enabled: true,
                            min_size_mb: 0,
                            extra_folders: Vec::new(),
                        });
                    (cfg, reload)
                };

                if should_reload || cfg.enabled != last_enabled {
                    last_enabled = cfg.enabled;
                    pending.clear();
                    active_watcher = None;
                    watched_roots.clear();

                    let (new_tx, new_rx) = mpsc::channel();
                    tx = new_tx;
                    rx = new_rx;

                    if cfg.enabled {
                        let (w, roots) = rebuild_watcher(tx.clone(), &cfg.extra_folders);
                        active_watcher = w;
                        watched_roots = roots;
                    }
                }

                // 2. Drenar eventos recibidos por `notify` (bloqueo suave de 800 ms)
                match rx.recv_timeout(Duration::from_millis(800)) {
                    Ok(Ok(event)) => {
                        if cfg.enabled && is_relevant_notify_event(&event.kind) {
                            enqueue_event_paths(&app_handle, &event, &watched_roots, &mut pending);
                        }
                        // Drenar ráfaga inmediata sin bloquear
                        while let Ok(Ok(extra_ev)) = rx.try_recv() {
                            if cfg.enabled && is_relevant_notify_event(&extra_ev.kind) {
                                enqueue_event_paths(
                                    &app_handle,
                                    &extra_ev,
                                    &watched_roots,
                                    &mut pending,
                                );
                            }
                        }
                    }
                    Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        thread::sleep(Duration::from_secs(1));
                    }
                }

                if !cfg.enabled || active_watcher.is_none() {
                    continue;
                }

                // Limpiar historial de deduplicación (> 90 segundos)
                let now = Instant::now();
                recently_notified.retain(|_, ts| now.duration_since(*ts) < Duration::from_secs(90));

                if pending.is_empty() {
                    continue;
                }

                // No disparar mientras DiskVault Clean esté ejecutando una migración propia
                if app_handle
                    .state::<MoverState>()
                    .is_running
                    .load(Ordering::SeqCst)
                {
                    pending.clear();
                    continue;
                }

                // 3. Evaluar estabilidad de cada candidato pendiente
                let min_bytes = u64::from(cfg.min_size_mb).saturating_mul(1024 * 1024);
                let keys: Vec<String> = pending.keys().cloned().collect();
                let mut ready_events: Vec<(String, IncomingFileEvent)> = Vec::new();
                let mut remove_keys: Vec<String> = Vec::new();

                for key in keys {
                    let Some(cand) = pending.get_mut(&key) else {
                        continue;
                    };

                    if !cand.path.exists() || is_ignored_incoming_path(&cand.path) {
                        remove_keys.push(key);
                        continue;
                    }

                    let Some((is_dir, files_count, total_bytes, readable)) =
                        measure_candidate(&cand.path)
                    else {
                        remove_keys.push(key);
                        continue;
                    };

                    if total_bytes != cand.last_size
                        || files_count != cand.last_files_count
                        || !readable
                    {
                        cand.last_size = total_bytes;
                        cand.last_files_count = files_count;
                        cand.last_change = now;
                        cand.stable_ticks = 0;
                        continue;
                    }

                    cand.stable_ticks = cand.stable_ticks.saturating_add(1);

                    // Esperar al menos 1.6s de estabilidad para asegurar fin de descarga o copia USB
                    if now.duration_since(cand.last_change) < Duration::from_millis(1600)
                        || cand.stable_ticks < 2
                    {
                        continue;
                    }

                    remove_keys.push(key.clone());

                    // Ignorar archivos vacíos de 0 bytes (plantillas recién creadas) o menores al umbral configurado
                    if total_bytes == 0 || total_bytes < min_bytes {
                        continue;
                    }

                    if recently_notified.contains_key(&key) {
                        continue;
                    }

                    let file_name = cand
                        .path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| cand.path.to_string_lossy().to_string());

                    let targets = app_handle
                        .state::<AppState>()
                        .db
                        .list_nas_targets()
                        .unwrap_or_default();

                    let incoming = IncomingFileEvent {
                        id: next_event_id(),
                        path: cand.path.to_string_lossy().to_string(),
                        file_name,
                        origin_label: cand.origin_label.clone(),
                        is_dir,
                        files_count,
                        total_bytes,
                        detected_at: chrono::Utc::now().to_rfc3339(),
                        available_targets_count: targets.len(),
                        is_test: false,
                    };

                    ready_events.push((key, incoming));
                }

                for key in remove_keys {
                    pending.remove(&key);
                }

                // 4. Emitir eventos y disparar notificación nativa de Windows
                if !ready_events.is_empty() {
                    let app_state = app_handle.state::<AppState>();
                    let watcher_state = app_handle.state::<WatcherState>();
                    let targets = app_state.db.list_nas_targets().unwrap_or_default();
                    let portable = app_state.paths.is_portable;

                    for (key, ev) in ready_events {
                        recently_notified.insert(key, now);
                        watcher_state.push_recent_event(ev.clone());
                        let _ = app_handle.emit("incoming-file-detected", ev.clone());
                        let _ = send_windows_incoming_notification(
                            &app_handle,
                            &ev,
                            &targets,
                            portable,
                        );
                    }
                }
            }
        });
}

fn enqueue_event_paths(
    app_handle: &AppHandle,
    event: &Event,
    watched_roots: &[(PathBuf, String)],
    pending: &mut HashMap<String, PendingCandidate>,
) {
    if app_handle
        .state::<MoverState>()
        .is_running
        .load(Ordering::SeqCst)
    {
        return;
    }

    let app_state = app_handle.state::<AppState>();
    let mut excluded_roots = vec![
        app_state.paths.data_dir.clone(),
        app_state.paths.logs_dir.clone(),
    ];
    if let Ok(targets) = app_state.db.list_nas_targets() {
        for target in targets {
            excluded_roots.push(PathBuf::from(target.path));
        }
    }

    let now = Instant::now();
    for raw_path in &event.paths {
        let Some((top_path, origin_label)) = resolve_watched_origin(raw_path, watched_roots) else {
            continue;
        };

        if is_ignored_incoming_path(&top_path) || is_inside_excluded_root(&top_path, &excluded_roots)
        {
            continue;
        }

        let key = normalize_path_key(&top_path);
        if key.is_empty() {
            continue;
        }

        pending
            .entry(key)
            .and_modify(|existing| {
                existing.last_change = now;
                existing.stable_ticks = 0;
            })
            .or_insert_with(|| PendingCandidate {
                path: top_path,
                origin_label,
                last_change: now,
                last_size: 0,
                last_files_count: 0,
                stable_ticks: 0,
            });
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_notification_copy, format_bytes_short, is_ignored_incoming_path,
        is_inside_excluded_root, IncomingFileEvent,
    };
    use crate::storage::db::NasTarget;
    use std::path::{Path, PathBuf};

    #[test]
    fn ignora_archivos_temporales_de_navegadores_y_sistema() {
        assert!(is_ignored_incoming_path(Path::new(
            r"C:\Users\Demo\Downloads\video.mp4.crdownload"
        )));
        assert!(is_ignored_incoming_path(Path::new(
            r"C:\Users\Demo\Downloads\archivo.zip.part"
        )));
        assert!(is_ignored_incoming_path(Path::new(
            r"C:\Users\Demo\Desktop\desktop.ini"
        )));
        assert!(is_ignored_incoming_path(Path::new(
            r"C:\Users\Demo\Documents\~$Documento.docx"
        )));
        assert!(is_ignored_incoming_path(Path::new(
            r"C:\Users\Demo\Desktop\AccesoDirecto.lnk"
        )));

        assert!(!is_ignored_incoming_path(Path::new(
            r"C:\Users\Demo\Downloads\pelicula_4k.mp4"
        )));
        assert!(!is_ignored_incoming_path(Path::new(
            r"C:\Users\Demo\Downloads\Fotos_USB_Vacaciones"
        )));
        assert!(!is_ignored_incoming_path(Path::new(
            r"C:\Users\Demo\Documents\Contrato_2026.pdf"
        )));
    }

    #[test]
    fn excluye_rutas_dentro_de_destinos_nas_o_carpetas_internas() {
        let excluded = vec![
            PathBuf::from(r"D:\RespaldosNAS"),
            PathBuf::from(r"C:\Users\Demo\AppData\Roaming\DiskVaultClean"),
        ];

        assert!(is_inside_excluded_root(
            Path::new(r"D:\RespaldosNAS\archivo.zip"),
            &excluded
        ));
        assert!(is_inside_excluded_root(
            Path::new(r"c:\users\demo\appdata\roaming\diskvaultclean\logs\update.log"),
            &excluded
        ));
        assert!(!is_inside_excluded_root(
            Path::new(r"C:\Users\Demo\Downloads\instalador.exe"),
            &excluded
        ));
    }

    #[test]
    fn formatea_tamanos_cortos_legibles() {
        assert_eq!(format_bytes_short(512), "512 B");
        assert_eq!(format_bytes_short(1024 * 45), "45 KB");
        assert_eq!(format_bytes_short(1024 * 1024 * 128), "128.0 MB");
        assert_eq!(format_bytes_short(1024 * 1024 * 1024 * 2), "2.00 GB");
    }

    #[test]
    fn genera_textos_claros_para_notificacion_windows() {
        let ev = IncomingFileEvent {
            id: "inc-1".to_string(),
            path: r"C:\Users\Demo\Downloads\Backup.zip".to_string(),
            file_name: "Backup.zip".to_string(),
            origin_label: "Descargas".to_string(),
            is_dir: false,
            files_count: 1,
            total_bytes: 50 * 1024 * 1024,
            detected_at: "2026-01-01T00:00:00Z".to_string(),
            available_targets_count: 1,
            is_test: false,
        };
        let targets = vec![NasTarget {
            id: 1,
            name: "NAS Casa".to_string(),
            path: r"\\192.168.1.50\Respaldos".to_string(),
            is_network: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_tested_at: None,
            last_free_bytes: None,
        }];

        let (title, line1, line2) = build_notification_copy(&ev, &targets);
        assert!(title.contains("DiskVault Clean"));
        assert!(line1.contains("Backup.zip"));
        assert!(line1.contains("Descargas"));
        assert!(line2.contains("NAS Casa"));
    }
}
