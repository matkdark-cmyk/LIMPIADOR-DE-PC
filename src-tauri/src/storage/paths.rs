use std::fs;
use std::path::PathBuf;

/// Nombre del archivo marcador junto al ejecutable que activa el Modo Portable.
pub const PORTABLE_FLAG_FILENAME: &str = "portable.flag";

/// Carpeta de datos en Modo Instalado bajo `%APPDATA%`.
const INSTALLED_APP_FOLDER: &str = "DiskVaultClean";

/// Rutas resueltas para la instancia actual de DiskVault Clean.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub exe_dir: PathBuf,
    pub is_portable: bool,
    pub data_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub db_path: PathBuf,
}

/// Resuelve las rutas de almacenamiento detectando automáticamente si existe `portable.flag`
/// junto al ejecutable `.exe` y crea las carpetas necesarias (`data_dir`, `data_dir/logs`).
pub fn resolve_app_paths() -> Result<AppPaths, String> {
    let exe_path = std::env::current_exe().map_err(|err| {
        format!("No se pudo obtener la ruta del ejecutable actual: {err}")
    })?;

    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta contenedora del ejecutable.".to_string())?
        .to_path_buf();

    let portable_flag_path = exe_dir.join(PORTABLE_FLAG_FILENAME);
    let is_portable = portable_flag_path.exists();

    let data_dir = if is_portable {
        exe_dir.join("data")
    } else {
        let appdata_dir = dirs::config_dir().ok_or_else(|| {
            "No se pudo localizar la carpeta de configuración del usuario (%APPDATA%).".to_string()
        })?;
        appdata_dir.join(INSTALLED_APP_FOLDER)
    };

    let logs_dir = data_dir.join("logs");
    let db_path = data_dir.join("diskvault.db");

    fs::create_dir_all(&data_dir).map_err(|err| {
        format!(
            "No se pudo crear la carpeta de datos '{}': {err}",
            data_dir.display()
        )
    })?;

    fs::create_dir_all(&logs_dir).map_err(|err| {
        format!(
            "No se pudo crear la carpeta de registros '{}': {err}",
            logs_dir.display()
        )
    })?;

    Ok(AppPaths {
        exe_dir,
        is_portable,
        data_dir,
        logs_dir,
        db_path,
    })
}
