use tauri::AppHandle;

/// Rutas válidas de la aplicación que se pueden restaurar tras cambiar permisos UAC.
const VALID_ROUTES: &[&str] = &[
    "dashboard",
    "analyzer",
    "apps",
    "nas",
    "cleaner",
    "ram",
    "settings",
];

/// Bandera interna usada para evitar bucles de auto-elevación o al volver a modo estándar.
pub const NO_AUTO_ELEVATE_FLAG: &str = "--no-auto-elevate";

/// Valida y normaliza un identificador de ruta para evitar inyección de argumentos.
pub fn sanitize_route(route: &str) -> String {
    let trimmed = route.trim().to_lowercase();
    if VALID_ROUTES.contains(&trimmed.as_str()) {
        trimmed
    } else {
        "dashboard".to_string()
    }
}

/// Lee el argumento `--route <seccion>` (o `--route=<seccion>`) pasado al iniciar el proceso.
pub fn parse_initial_route_from_args() -> String {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--route" {
            if let Some(value) = args.next() {
                return sanitize_route(&value);
            }
        } else if let Some(value) = arg.strip_prefix("--route=") {
            return sanitize_route(value);
        }
    }
    "dashboard".to_string()
}

/// Indica si el proceso recibió `--no-auto-elevate` (por ejemplo, tras cancelar UAC o al desactivar Admin).
pub fn has_no_auto_elevate_flag() -> bool {
    std::env::args()
        .skip(1)
        .any(|arg| arg == NO_AUTO_ELEVATE_FLAG)
}

/// Construye argumentos seguros para relanzar DiskVault Clean preservando la vista actual.
pub fn build_relaunch_params(route: &str, suppress_auto_elevate: bool) -> String {
    let safe_route = sanitize_route(route);
    if suppress_auto_elevate {
        format!("--route {safe_route} {NO_AUTO_ELEVATE_FLAG}")
    } else {
        format!("--route {safe_route}")
    }
}

/// Determina si el proceso actual se ejecuta con privilegios de Administrador en Windows.
#[cfg(windows)]
pub fn is_running_as_admin() -> bool {
    use std::mem::size_of;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token_handle = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token_handle).is_err() {
            return false;
        }

        let mut elevation = TOKEN_ELEVATION::default();
        let mut return_length: u32 = 0;

        let result = GetTokenInformation(
            token_handle,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_length,
        );

        let _ = CloseHandle(token_handle);
        result.is_ok() && elevation.TokenIsElevated != 0
    }
}

/// Fallback limpio para compilación/pruebas fuera de Windows.
#[cfg(not(windows))]
pub fn is_running_as_admin() -> bool {
    false
}

/// Invoca `ShellExecuteW` con verbo `"runas"` para lanzar una nueva instancia elevada.
/// Devuelve `Ok(true)` si se lanzó correctamente la instancia elevada, `Ok(false)` si ya era Admin,
/// o `Err(...)` si el usuario canceló el aviso UAC o ocurrió un error.
#[cfg(windows)]
pub fn spawn_elevated_instance(current_route: &str) -> Result<bool, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, ERROR_CANCELLED, HWND};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if is_running_as_admin() {
        return Ok(false);
    }

    let exe_path = std::env::current_exe().map_err(|err| {
        format!("No se pudo determinar la ubicación del ejecutable actual: {err}")
    })?;

    let params = build_relaunch_params(current_route, true);

    let to_wide = |value: &OsStr| -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    };

    let verb_wide = to_wide(OsStr::new("runas"));
    let exe_wide = to_wide(exe_path.as_os_str());
    let params_wide = to_wide(OsStr::new(&params));

    let result = unsafe {
        ShellExecuteW(
            HWND::default(),
            PCWSTR(verb_wide.as_ptr()),
            PCWSTR(exe_wide.as_ptr()),
            PCWSTR(params_wide.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    // Según la documentación de Win32, ShellExecuteW devuelve un valor > 32 cuando tiene éxito.
    let code = result.0 as isize;
    if code > 32 {
        return Ok(true);
    }

    let last_error = unsafe { GetLastError() };
    if last_error == ERROR_CANCELLED || code == 5 {
        return Err(
            "No se activó el Modo Administrador porque cancelaste el aviso de permisos de Windows (UAC). La aplicación continúa en modo estándar."
                .to_string(),
        );
    }

    Err(format!(
        "No fue posible iniciar DiskVault Clean como Administrador (código {}, detalle {}).",
        code, last_error.0
    ))
}

#[cfg(not(windows))]
pub fn spawn_elevated_instance(_current_route: &str) -> Result<bool, String> {
    Err(
        "La elevación de permisos UAC solo está disponible al ejecutar DiskVault Clean en Windows."
            .to_string(),
    )
}

/// Relanza el ejecutable actual con elevación UAC preservando la vista activa.
/// Si el usuario acepta UAC, cierra la instancia actual.
pub fn elevate_with_uac(app_handle: &AppHandle, current_route: &str) -> Result<(), String> {
    if spawn_elevated_instance(current_route)? {
        app_handle.exit(0);
    }
    Ok(())
}

/// Relanza DiskVault Clean en modo Usuario Estándar (sin elevación) usando
/// `runas.exe /trustlevel:0x20000` (SAFER Medium Integrity Level de Windows).
/// Devuelve `Ok(true)` si se lanzó la instancia estándar y cerró la elevada,
/// o `Ok(false)` si ya estaba en modo estándar o no fue posible relanzar al instante.
#[cfg(windows)]
pub fn relaunch_as_standard_user(
    app_handle: &AppHandle,
    current_route: &str,
) -> Result<bool, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    if !is_running_as_admin() {
        return Ok(false);
    }

    let exe_path = std::env::current_exe().map_err(|err| {
        format!("No se pudo determinar la ubicación del ejecutable actual: {err}")
    })?;

    let params = build_relaunch_params(current_route, true);
    let command_line = format!("\"{}\" {}", exe_path.display(), params);

    let status = Command::new("runas.exe")
        .args(["/trustlevel:0x20000", &command_line])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    match status {
        Ok(exit) if exit.success() => {
            app_handle.exit(0);
            Ok(true)
        }
        _ => Ok(false),
    }
}

#[cfg(not(windows))]
pub fn relaunch_as_standard_user(
    _app_handle: &AppHandle,
    _current_route: &str,
) -> Result<bool, String> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::{build_relaunch_params, sanitize_route, NO_AUTO_ELEVATE_FLAG};

    #[test]
    fn sanitiza_rutas_y_construye_parametros_seguros() {
        assert_eq!(sanitize_route("settings"), "settings");
        assert_eq!(sanitize_route("NAS"), "nas");
        assert_eq!(sanitize_route("malicious && calc.exe"), "dashboard");
        assert_eq!(
            build_relaunch_params("cleaner", true),
            format!("--route cleaner {NO_AUTO_ELEVATE_FLAG}")
        );
        assert_eq!(build_relaunch_params("ram", false), "--route ram");
    }
}
