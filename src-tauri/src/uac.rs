use tauri::AppHandle;

/// Rutas válidas de la aplicación que se pueden restaurar tras elevar permisos UAC.
const VALID_ROUTES: &[&str] = &[
    "dashboard",
    "analyzer",
    "apps",
    "nas",
    "cleaner",
    "ram",
    "settings",
];

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

/// Relanza el ejecutable actual con elevación UAC (`ShellExecuteW` con verbo `"runas"`)
/// preservando la vista activa mediante `--route <current_route>`.
///
/// Si el usuario acepta UAC, cierra la instancia actual. Si cancela, devuelve un
/// mensaje amigable en español sin cerrar la aplicación.
#[cfg(windows)]
pub fn elevate_with_uac(app_handle: &AppHandle, current_route: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, ERROR_CANCELLED, HWND};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if is_running_as_admin() {
        return Ok(());
    }

    let exe_path = std::env::current_exe().map_err(|err| {
        format!("No se pudo determinar la ubicación del ejecutable actual: {err}")
    })?;

    let safe_route = sanitize_route(current_route);
    let params = format!("--route {safe_route}");

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
        app_handle.exit(0);
        return Ok(());
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
pub fn elevate_with_uac(_app_handle: &AppHandle, _current_route: &str) -> Result<(), String> {
    Err(
        "La elevación de permisos UAC solo está disponible al ejecutar DiskVault Clean en Windows."
            .to_string(),
    )
}
