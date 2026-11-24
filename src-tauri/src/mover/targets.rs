use chrono::Utc;
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Resultado de prueba de conectividad, permisos de escritura y espacio disponible en un destino.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NasConnectionStatus {
    pub reachable: bool,
    pub writable: bool,
    pub free_bytes: u64,
    pub total_bytes: u64,
    pub is_network: bool,
    pub message: String,
}

/// Detecta si una ruta corresponde a un recurso de red UNC (`\\servidor\recurso`) o unidad de red mapeada.
pub fn is_network_destination(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.starts_with(r"\\") || trimmed.starts_with("//") {
        return true;
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::GetDriveTypeW;
        // DRIVE_REMOTE = 4 en Win32
        const DRIVE_REMOTE: u32 = 4;

        let bytes = trimmed.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            let root = format!("{}:\\", &trimmed[..1]);
            let wide: Vec<u16> = std::ffi::OsStr::new(&root)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let drive_type = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
            return drive_type == DRIVE_REMOTE;
        }
    }

    false
}

/// Extrae la raíz de recurso compartido SMB (`\\servidor\carpeta`) a partir de cualquier ruta UNC.
pub fn extract_unc_share_root(path: &str) -> Option<String> {
    let normalized = path.trim().replace('/', "\\");
    if !normalized.starts_with(r"\\") {
        return None;
    }
    let parts: Vec<&str> = normalized[2..]
        .split('\\')
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() >= 2 {
        Some(format!(r"\\{}\{}", parts[0], parts[1]))
    } else {
        None
    }
}

/// Autentica una sesión SMB contra una ruta UNC usando `WNetAddConnection2W` de Windows.
///
/// Regla de seguridad: las credenciales nunca se guardan en SQLite ni en logs.
/// Si `remember_in_windows` es `true`, se delega a Windows Credential Manager (`CONNECT_UPDATE_PROFILE`).
#[cfg(windows)]
fn authenticate_smb_share(
    unc_path: &str,
    username: &str,
    password: &str,
    remember_in_windows: bool,
) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::NetworkManagement::WNet::{
        WNetAddConnection2W, CONNECT_UPDATE_PROFILE, NETRESOURCEW, NET_CONNECT_FLAGS,
        RESOURCETYPE_DISK,
    };

    let share_root = extract_unc_share_root(unc_path).ok_or_else(|| {
        "La ruta de red UNC debe tener el formato \\\\SERVIDOR\\CarpetaCompartida.".to_string()
    })?;

    let to_wide = |s: &str| -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };

    let mut remote_wide = to_wide(&share_root);
    let user_wide = to_wide(username.trim());
    let pass_wide = to_wide(password);

    let net_resource = NETRESOURCEW {
        dwType: RESOURCETYPE_DISK,
        lpRemoteName: PWSTR(remote_wide.as_mut_ptr()),
        ..Default::default()
    };

    let flags = if remember_in_windows {
        CONNECT_UPDATE_PROFILE
    } else {
        NET_CONNECT_FLAGS(0)
    };

    let err = unsafe {
        WNetAddConnection2W(
            &net_resource,
            PCWSTR(pass_wide.as_ptr()),
            PCWSTR(user_wide.as_ptr()),
            flags,
        )
    };

    match err.0 {
        // NO_ERROR (0) o ERROR_ALREADY_ASSIGNED (85)
        0 | 85 => Ok(()),
        1219 => Err(
            "Windows ya tiene una conexión abierta con este servidor usando otro usuario. Prueba conectar sin credenciales o cierra la sesión previa en Windows."
                .to_string(),
        ),
        5 | 86 | 1326 => Err(
            "El NAS rechazó el usuario o la contraseña ingresados. Verifica tus credenciales SMB."
                .to_string(),
        ),
        53 | 67 | 1203 => Err(
            "No se pudo encontrar la carpeta compartida en la red. Verifica la IP del NAS y el nombre del recurso compartido."
                .to_string(),
        ),
        other => Err(format!(
            "No se pudo autenticar la conexión SMB con el NAS (código Windows {other})."
        )),
    }
}

#[cfg(not(windows))]
fn authenticate_smb_share(
    _unc_path: &str,
    _username: &str,
    _password: &str,
    _remember_in_windows: bool,
) -> Result<(), String> {
    Ok(())
}

/// Consulta el espacio libre disponible y total para una ruta local o UNC usando `GetDiskFreeSpaceExW`.
#[cfg(windows)]
pub fn query_destination_space(path: &Path) -> Result<(u64, u64), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let mut target = path.to_path_buf();
    while !target.exists() {
        match target.parent() {
            Some(parent) => target = parent.to_path_buf(),
            None => break,
        }
    }

    let wide: Vec<u16> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut free_available: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free: u64 = 0;

    unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(wide.as_ptr()),
            Some(&mut free_available as *mut u64),
            Some(&mut total_bytes as *mut u64),
            Some(&mut total_free as *mut u64),
        )
    }
    .map_err(|err| {
        format!(
            "No se pudo consultar el espacio disponible en '{}': {err}",
            path.display()
        )
    })?;

    Ok((free_available, total_bytes))
}

#[cfg(not(windows))]
pub fn query_destination_space(path: &Path) -> Result<(u64, u64), String> {
    use sysinfo::Disks;

    let disks = Disks::new_with_refreshed_list();
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut best_match: Option<(usize, u64, u64)> = None;

    for disk in disks.list() {
        let mount = disk.mount_point();
        if canonical.starts_with(mount) {
            let depth = mount.as_os_str().len();
            if best_match.map(|(d, _, _)| depth > d).unwrap_or(true) {
                best_match = Some((depth, disk.available_space(), disk.total_space()));
            }
        }
    }

    if let Some((_, free, total)) = best_match {
        Ok((free, total))
    } else {
        Ok((0, 0))
    }
}

/// Prueba accesibilidad real, autenticación SMB opcional, permiso real de escritura y espacio libre.
pub fn test_nas_connection(
    path: &str,
    username: Option<String>,
    password: Option<String>,
    remember_in_windows: bool,
) -> Result<NasConnectionStatus, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Debes indicar una ruta de destino válida.".to_string());
    }

    let is_network = is_network_destination(trimmed);

    // 1. Autenticación SMB si el usuario proporcionó credenciales para una ruta UNC
    if let Some(ref user) = username {
        if !user.trim().is_empty() && (trimmed.starts_with(r"\\") || trimmed.starts_with("//")) {
            let pass = password.as_deref().unwrap_or("");
            authenticate_smb_share(trimmed, user, pass, remember_in_windows)?;
        }
    }

    let target_path = Path::new(trimmed);

    // 2. Comprueba existencia y accesibilidad de la carpeta destino
    if !target_path.exists() {
        return Ok(NasConnectionStatus {
            reachable: false,
            writable: false,
            free_bytes: 0,
            total_bytes: 0,
            is_network,
            message: format!(
                "No se puede acceder a '{}'. Verifica que el NAS esté encendido, conectado a la red o que la carpeta exista.",
                trimmed
            ),
        });
    }

    if !target_path.is_dir() {
        return Ok(NasConnectionStatus {
            reachable: false,
            writable: false,
            free_bytes: 0,
            total_bytes: 0,
            is_network,
            message: "La ruta de destino debe ser una carpeta, no un archivo.".to_string(),
        });
    }

    // 3. Prueba real de escritura creando y borrando inmediatamente un archivo diminuto
    let probe_name = format!(
        ".diskvault_write_test_{}",
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    );
    let probe_path = target_path.join(probe_name);

    let writable = match fs::write(&probe_path, b"diskvault_ok") {
        Ok(()) => {
            let _ = fs::remove_file(&probe_path);
            true
        }
        Err(_) => false,
    };

    // 4. Consulta espacio libre y total real (local o SMB/UNC)
    let (free_bytes, total_bytes) = query_destination_space(target_path).unwrap_or((0, 0));

    let message = if writable {
        if is_network {
            "Conexión de red verificada con permisos de lectura y escritura.".to_string()
        } else {
            "Destino local verificado con permisos de lectura y escritura.".to_string()
        }
    } else {
        "La carpeta es visible, pero no tienes permisos de escritura en este destino. Revisa los permisos del recurso compartido o inicia sesión con otro usuario."
            .to_string()
    };

    Ok(NasConnectionStatus {
        reachable: true,
        writable,
        free_bytes,
        total_bytes,
        is_network,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::extract_unc_share_root;

    #[test]
    fn extrae_raiz_de_recurso_compartido_unc() {
        assert_eq!(
            extract_unc_share_root(r"\\192.168.1.50\Respaldos\Fotos\2026"),
            Some(r"\\192.168.1.50\Respaldos".to_string())
        );
        assert_eq!(
            extract_unc_share_root(r"\\MI-NAS\Backups"),
            Some(r"\\MI-NAS\Backups".to_string())
        );
        assert_eq!(extract_unc_share_root(r"D:\Respaldos"), None);
    }
}
