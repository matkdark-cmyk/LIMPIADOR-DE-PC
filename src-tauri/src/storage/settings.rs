use crate::storage::db::{AuditLogEntry, Database, TransferHistoryEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

const KEY_THEME: &str = "theme";
const KEY_USE_RECYCLE_BIN: &str = "default_use_recycle_bin";
const KEY_INACTIVE_DAYS: &str = "default_inactive_days";
const KEY_CONFIRM_PERMANENT: &str = "confirm_before_permanent_delete";
const KEY_RAM_EXCLUDED: &str = "ram_excluded_processes";
const KEY_CLEANER_EXCLUDED: &str = "cleaner_excluded_paths";
const KEY_NAS_DEFAULT_MODE: &str = "nas_default_mode";
const KEY_START_WITH_WINDOWS: &str = "start_with_windows";

/// Configuración consolidada de DiskVault Clean persistida en la tabla `settings` de SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub default_use_recycle_bin: bool,
    pub default_inactive_days: u32,
    pub confirm_before_permanent_delete: bool,
    pub ram_excluded_processes: Vec<String>,
    pub cleaner_excluded_paths: Vec<String>,
    pub nas_default_mode: String,
    pub start_with_windows: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            default_use_recycle_bin: true,
            default_inactive_days: 30,
            confirm_before_permanent_delete: true,
            ram_excluded_processes: Vec::new(),
            cleaner_excluded_paths: Vec::new(),
            nas_default_mode: "archive_free".to_string(),
            start_with_windows: false,
        }
    }
}

impl AppSettings {
    /// Normaliza valores, deduplica exclusiones y bloquea el inicio con Windows en Modo Portable.
    pub fn sanitized(mut self, is_portable: bool) -> Self {
        self.theme = match self.theme.trim().to_ascii_lowercase().as_str() {
            "light" => "light".to_string(),
            "dark" => "dark".to_string(),
            _ => "system".to_string(),
        };

        self.default_inactive_days = self.default_inactive_days.clamp(1, 3650);

        self.nas_default_mode = match self.nas_default_mode.trim().to_ascii_lowercase().as_str() {
            "move_symlink" => "move_symlink".to_string(),
            "copy_backup" => "copy_backup".to_string(),
            _ => "archive_free".to_string(),
        };

        self.ram_excluded_processes = dedupe_clean_list(self.ram_excluded_processes, true);
        self.cleaner_excluded_paths = dedupe_clean_list(self.cleaner_excluded_paths, false);

        // Regla estricta Portable: cero escritura al Registro de Windows
        if is_portable {
            self.start_with_windows = false;
        }

        self
    }
}

fn dedupe_clean_list(items: Vec<String>, lowercase_values: bool) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in items {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_ascii_lowercase();
        if seen.insert(key.clone()) {
            out.push(if lowercase_values {
                key
            } else {
                trimmed.to_string()
            });
        }
    }
    out
}

fn parse_bool(raw: Option<String>, fallback: bool) -> bool {
    match raw.as_deref().map(str::trim) {
        Some("true") | Some("1") => true,
        Some("false") | Some("0") => false,
        _ => fallback,
    }
}

fn parse_string_vec(raw: Option<String>) -> Vec<String> {
    raw.and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
        .unwrap_or_default()
}

/// Lee todos los ajustes desde SQLite aplicando defaults seguros y restricciones del modo portable.
pub fn load_settings_from_db(db: &Database, is_portable: bool) -> AppSettings {
    let defaults = AppSettings::default();

    let theme = db
        .get_setting(KEY_THEME)
        .ok()
        .flatten()
        .unwrap_or(defaults.theme);

    let default_use_recycle_bin = parse_bool(
        db.get_setting(KEY_USE_RECYCLE_BIN).ok().flatten(),
        defaults.default_use_recycle_bin,
    );

    let default_inactive_days = db
        .get_setting(KEY_INACTIVE_DAYS)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(defaults.default_inactive_days);

    let confirm_before_permanent_delete = parse_bool(
        db.get_setting(KEY_CONFIRM_PERMANENT).ok().flatten(),
        defaults.confirm_before_permanent_delete,
    );

    let ram_excluded_processes =
        parse_string_vec(db.get_setting(KEY_RAM_EXCLUDED).ok().flatten());
    let cleaner_excluded_paths =
        parse_string_vec(db.get_setting(KEY_CLEANER_EXCLUDED).ok().flatten());

    let nas_default_mode = db
        .get_setting(KEY_NAS_DEFAULT_MODE)
        .ok()
        .flatten()
        .unwrap_or(defaults.nas_default_mode);

    let start_with_windows = parse_bool(
        db.get_setting(KEY_START_WITH_WINDOWS).ok().flatten(),
        defaults.start_with_windows,
    );

    AppSettings {
        theme,
        default_use_recycle_bin,
        default_inactive_days,
        confirm_before_permanent_delete,
        ram_excluded_processes,
        cleaner_excluded_paths,
        nas_default_mode,
        start_with_windows,
    }
    .sanitized(is_portable)
}

/// Persiste todos los ajustes normalizados en la tabla `settings` de SQLite.
pub fn save_settings_to_db(
    db: &Database,
    raw: AppSettings,
    is_portable: bool,
) -> Result<AppSettings, String> {
    let clean = raw.sanitized(is_portable);

    let ram_json = serde_json::to_string(&clean.ram_excluded_processes)
        .map_err(|err| format!("No se pudo serializar exclusiones de RAM: {err}"))?;
    let cleaner_json = serde_json::to_string(&clean.cleaner_excluded_paths)
        .map_err(|err| format!("No se pudo serializar exclusiones de caché: {err}"))?;

    db.save_setting(KEY_THEME, &clean.theme)?;
    db.save_setting(
        KEY_USE_RECYCLE_BIN,
        if clean.default_use_recycle_bin {
            "true"
        } else {
            "false"
        },
    )?;
    db.save_setting(KEY_INACTIVE_DAYS, &clean.default_inactive_days.to_string())?;
    db.save_setting(
        KEY_CONFIRM_PERMANENT,
        if clean.confirm_before_permanent_delete {
            "true"
        } else {
            "false"
        },
    )?;
    db.save_setting(KEY_RAM_EXCLUDED, &ram_json)?;
    db.save_setting(KEY_CLEANER_EXCLUDED, &cleaner_json)?;
    db.save_setting(KEY_NAS_DEFAULT_MODE, &clean.nas_default_mode)?;
    db.save_setting(
        KEY_START_WITH_WINDOWS,
        if clean.start_with_windows {
            "true"
        } else {
            "false"
        },
    )?;

    Ok(clean)
}

/// Sincroniza el inicio automático en `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\DiskVaultClean`
/// SOLO cuando el modo NO es portable.
pub fn sync_windows_autostart(enabled: bool, is_portable: bool) -> Result<(), String> {
    if is_portable {
        return Ok(());
    }

    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
        use winreg::RegKey;

        const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
        const VALUE_NAME: &str = "DiskVaultClean";

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(RUN_KEY_PATH, KEY_SET_VALUE)
            .map_err(|err| {
                format!("No se pudo abrir la clave de inicio automático de Windows: {err}")
            })?;

        if enabled {
            let exe = std::env::current_exe().map_err(|err| {
                format!("No se pudo determinar la ruta del ejecutable para inicio automático: {err}")
            })?;
            let command = format!("\"{}\"", exe.display());
            run_key
                .set_value(VALUE_NAME, &command)
                .map_err(|err| format!("No se pudo registrar el inicio con Windows: {err}"))?;
        } else {
            match run_key.delete_value(VALUE_NAME) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    return Err(format!(
                        "No se pudo quitar DiskVault Clean del inicio de Windows: {err}"
                    ));
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = enabled;
    }

    Ok(())
}

fn normalize_path_key(raw: &str) -> String {
    let mut s = raw.trim().replace('/', "\\").to_ascii_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// Comprueba si una ruta objetivo cae dentro (o es igual) a alguna ruta excluida por el usuario.
pub fn is_path_excluded_by_user(target_path: &Path, excluded_paths: &[String]) -> bool {
    if excluded_paths.is_empty() {
        return false;
    }
    let target_norm = normalize_path_key(&target_path.to_string_lossy());
    if target_norm.is_empty() {
        return false;
    }

    excluded_paths.iter().any(|excl| {
        let excl_norm = normalize_path_key(excl);
        if excl_norm.is_empty() {
            return false;
        }
        if target_norm == excl_norm {
            return true;
        }
        let prefix = if excl_norm.ends_with('\\') {
            excl_norm
        } else {
            format!("{excl_norm}\\")
        };
        target_norm.starts_with(&prefix)
    })
}

fn escape_csv_cell(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditExportBundle {
    exported_at: String,
    audit_logs: Vec<AuditLogEntry>,
    transfer_history: Vec<TransferHistoryEntry>,
}

/// Exporta todo el historial de auditoría y transferencias a un archivo UTF-8 en formato CSV o JSON.
pub fn export_audit_logs_to_file(
    db: &Database,
    format: &str,
    dest_path: &Path,
) -> Result<usize, String> {
    let logs = db.get_all_audit_logs()?;
    let transfers = db.get_all_transfer_history()?;
    let total_records = logs.len() + transfers.len();

    let fmt = format.trim().to_ascii_lowercase();
    match fmt.as_str() {
        "json" => {
            let bundle = AuditExportBundle {
                exported_at: chrono::Utc::now().to_rfc3339(),
                audit_logs: logs,
                transfer_history: transfers,
            };
            let content = serde_json::to_string_pretty(&bundle)
                .map_err(|err| format!("No se pudo generar el archivo JSON: {err}"))?;
            fs::write(dest_path, content.as_bytes()).map_err(|err| {
                format!(
                    "No se pudo guardar el historial en '{}': {err}",
                    dest_path.display()
                )
            })?;
            Ok(total_records)
        }
        "csv" => {
            // BOM UTF-8 para compatibilidad inmediata con Microsoft Excel en español
            let mut out = String::from("\u{FEFF}tipo,fecha_iso,modulo_o_modo,accion,origen,destino,bytes,estado,detalles\r\n");

            for entry in &logs {
                let row = [
                    "auditoria".to_string(),
                    entry.timestamp.clone(),
                    entry.module.clone(),
                    entry.action.clone(),
                    entry.source_path.clone().unwrap_or_default(),
                    entry.dest_path.clone().unwrap_or_default(),
                    entry.bytes_affected.to_string(),
                    entry.status.clone(),
                    entry.details.clone().unwrap_or_default(),
                ]
                .iter()
                .map(|c| escape_csv_cell(c))
                .collect::<Vec<_>>()
                .join(",");
                out.push_str(&row);
                out.push_str("\r\n");
            }

            for tx in &transfers {
                let details = tx
                    .error_message
                    .clone()
                    .unwrap_or_else(|| format!("{} archivo(s), {} ms", tx.files_count, tx.duration_ms));
                let row = [
                    "transferencia_nas".to_string(),
                    tx.timestamp.clone(),
                    tx.mode.clone(),
                    "transferencia_segura".to_string(),
                    tx.source_path.clone(),
                    tx.dest_path.clone(),
                    tx.total_bytes.to_string(),
                    tx.status.clone(),
                    details,
                ]
                .iter()
                .map(|c| escape_csv_cell(c))
                .collect::<Vec<_>>()
                .join(",");
                out.push_str(&row);
                out.push_str("\r\n");
            }

            fs::write(dest_path, out.as_bytes()).map_err(|err| {
                format!(
                    "No se pudo guardar el historial CSV en '{}': {err}",
                    dest_path.display()
                )
            })?;
            Ok(total_records)
        }
        _ => Err("Formato de exportación no soportado. Usa 'csv' o 'json'.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_path_excluded_by_user, load_settings_from_db, save_settings_to_db, AppSettings,
    };
    use crate::storage::db::Database;
    use std::path::Path;

    fn create_temp_db(name: &str) -> (Database, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "diskvault_settings_test_{}_{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let db_path = dir.join("test.db");
        let _ = std::fs::remove_file(&db_path);
        let db = Database::init(&db_path).expect("debe inicializar SQLite temporal");
        (db, dir)
    }

    /// Prueba obligatoria 1: Carga de valores por defecto y persistencia en SQLite.
    #[test]
    fn carga_defaults_y_persiste_app_settings_en_sqlite() {
        let (db, dir) = create_temp_db("defaults_and_persist");

        let loaded_default = load_settings_from_db(&db, false);
        assert_eq!(loaded_default.theme, "system");
        assert!(loaded_default.default_use_recycle_bin);
        assert_eq!(loaded_default.default_inactive_days, 30);
        assert!(loaded_default.confirm_before_permanent_delete);
        assert_eq!(loaded_default.nas_default_mode, "archive_free");
        assert!(!loaded_default.start_with_windows);
        assert!(loaded_default.ram_excluded_processes.is_empty());
        assert!(loaded_default.cleaner_excluded_paths.is_empty());

        let custom = AppSettings {
            theme: "dark".to_string(),
            default_use_recycle_bin: false,
            default_inactive_days: 60,
            confirm_before_permanent_delete: true,
            ram_excluded_processes: vec!["obs64.exe".to_string(), "VLC.EXE".to_string()],
            cleaner_excluded_paths: vec![r"C:\Temp\MiCacheImportante".to_string()],
            nas_default_mode: "move_symlink".to_string(),
            start_with_windows: true,
        };

        let saved = save_settings_to_db(&db, custom, false).expect("debe guardar ajustes");
        assert_eq!(saved.theme, "dark");
        assert_eq!(saved.default_inactive_days, 60);
        assert!(saved.start_with_windows);

        let reloaded = load_settings_from_db(&db, false);
        assert_eq!(reloaded, saved);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Prueba obligatoria 2: `start_with_windows` se bloquea automáticamente en Modo Portable.
    #[test]
    fn bloquea_inicio_con_windows_cuando_es_portable() {
        let (db, dir) = create_temp_db("portable_block");

        let attempt = AppSettings {
            start_with_windows: true,
            ..AppSettings::default()
        };

        let saved = save_settings_to_db(&db, attempt, true).expect("debe guardar en portable");
        assert!(
            !saved.start_with_windows,
            "En Modo Portable start_with_windows siempre debe ser false"
        );

        let reloaded = load_settings_from_db(&db, true);
        assert!(!reloaded.start_with_windows);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Prueba obligatoria 3: Exclusiones de RAM y Cleaner se serializan, deduplican y aplican correctamente.
    #[test]
    fn exclusiones_ram_y_cleaner_se_serializan_y_aplican_correctamente() {
        let (db, dir) = create_temp_db("exclusions");

        let input = AppSettings {
            ram_excluded_processes: vec![
                "  Steam.exe ".to_string(),
                "steam.exe".to_string(),
                "obs64.exe".to_string(),
                "".to_string(),
            ],
            cleaner_excluded_paths: vec![
                r"C:\Users\Demo\AppData\Local\MiApp\Cache\".to_string(),
                r"c:\users\demo\appdata\local\miapp\cache\".to_string(),
            ],
            ..AppSettings::default()
        };

        let saved = save_settings_to_db(&db, input, false).expect("debe guardar exclusiones");
        assert_eq!(
            saved.ram_excluded_processes,
            vec!["steam.exe".to_string(), "obs64.exe".to_string()]
        );
        assert_eq!(saved.cleaner_excluded_paths.len(), 1);

        let reloaded = load_settings_from_db(&db, false);
        assert!(is_path_excluded_by_user(
            Path::new(r"C:\Users\Demo\AppData\Local\MiApp\Cache"),
            &reloaded.cleaner_excluded_paths
        ));
        assert!(is_path_excluded_by_user(
            Path::new(r"C:\Users\Demo\AppData\Local\MiApp\Cache\subcarpeta"),
            &reloaded.cleaner_excluded_paths
        ));
        assert!(!is_path_excluded_by_user(
            Path::new(r"C:\Users\Demo\AppData\Local\MiApp\CacheOtros"),
            &reloaded.cleaner_excluded_paths
        ));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
