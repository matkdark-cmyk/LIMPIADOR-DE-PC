use std::path::Path;

/// Determina si una ruta apunta a un recurso compartido de red UNC (`\\servidor\carpeta`).
pub fn is_unc_path(path: &Path) -> bool {
    let raw = path.to_string_lossy();
    raw.starts_with(r"\\") || raw.starts_with("//")
}

/// Crea un enlace transparente en `link_path` apuntando al destino real `target_path`.
///
/// - Si `target_path` está en un disco local NTFS: crea un **Directory Junction** (`junction::create`)
///   que funciona en Windows sin requerir permisos UAC.
/// - Si `target_path` es una ruta de red SMB/UNC (`\\NAS\...`): crea un enlace simbólico de directorio
///   (`symlink_dir`), el cual requiere Modo Administrador o Modo Desarrollador de Windows.
#[cfg(windows)]
pub fn create_transparent_link(target_path: &Path, link_path: &Path, is_dir: bool) -> Result<(), String> {
    if !is_dir {
        std::os::windows::fs::symlink_file(target_path, link_path).map_err(|err| {
            if err.raw_os_error() == Some(1314) {
                "Crear un enlace simbólico de archivo requiere activar el Modo Administrador (UAC) en Windows."
                    .to_string()
            } else {
                format!(
                    "No se pudo crear el enlace simbólico en '{}': {err}",
                    link_path.display()
                )
            }
        })?;
        return Ok(());
    }

    if is_unc_path(target_path) {
        std::os::windows::fs::symlink_dir(target_path, link_path).map_err(|err| {
            if err.raw_os_error() == Some(1314) {
                "Crear un enlace simbólico hacia un NAS en red (ruta UNC) requiere activar el Modo Administrador (UAC) en Windows."
                    .to_string()
            } else {
                format!(
                    "No se pudo crear el enlace simbólico hacia la carpeta de red '{}': {err}",
                    target_path.display()
                )
            }
        })?;
        Ok(())
    } else {
        junction::create(target_path, link_path).map_err(|err| {
            format!(
                "No se pudo crear el enlace NTFS (Junction) de '{}' hacia '{}': {err}",
                link_path.display(),
                target_path.display()
            )
        })
    }
}

#[cfg(not(windows))]
pub fn create_transparent_link(target_path: &Path, link_path: &Path, _is_dir: bool) -> Result<(), String> {
    std::os::unix::fs::symlink(target_path, link_path).map_err(|err| {
        format!(
            "No se pudo crear el enlace simbólico en '{}': {err}",
            link_path.display()
        )
    })
}

/// Elimina únicamente el enlace (Junction o Symlink) sin borrar los datos reales del destino.
pub fn remove_link_only(link_path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        if junction::exists(link_path).unwrap_or(false) {
            return junction::delete(link_path).map_err(|err| {
                format!(
                    "No se pudo eliminar el enlace NTFS '{}': {err}",
                    link_path.display()
                )
            });
        }
    }

    if link_path.is_dir() {
        std::fs::remove_dir(link_path)
    } else {
        std::fs::remove_file(link_path)
    }
    .map_err(|err| format!("No se pudo limpiar enlace parcial '{}': {err}", link_path.display()))
}
