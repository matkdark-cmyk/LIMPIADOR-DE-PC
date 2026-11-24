use crate::apps::inventory::{is_safe_specific_install_path, AppsState, InstalledApp};
use crate::security;
use crate::storage::db::Database;
use crate::uac;
use jwalk::WalkDir;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use sysinfo::{Pid, ProcessesToUpdate, System};

/// Información de un proceso activo perteneciente a la carpeta de una aplicación.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningProcessInfo {
    pub pid: u32,
    pub name: String,
    pub exe_path: String,
    pub memory_bytes: u64,
}

/// Resultado de ejecutar el desinstalador oficial de Windows o PowerShell Appx.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallExecutionResult {
    pub app_id: String,
    pub app_name: String,
    pub exit_code: Option<i32>,
    pub completed: bool,
    pub message: String,
}

/// Elemento residual detectado tras desinstalar una aplicación.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverItem {
    pub id: String,
    pub path: String,
    pub item_type: String, // "folder" | "file" | "registry"
    pub size_bytes: u64,
    pub risk: String,      // "safe" | "review"
    pub reason: String,
    pub registry_hive: Option<String>,
    pub registry_key_path: Option<String>,
}

/// Solicitud de limpieza enviada desde el modal de residuos.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverCleanRequest {
    pub path: String,
    pub item_type: String,
    pub registry_hive: Option<String>,
    pub registry_key_path: Option<String>,
}

/// Resultado tras limpiar los residuos seleccionados.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverCleanResult {
    pub cleaned_count: u32,
    pub failed_count: u32,
    pub bytes_freed: u64,
    pub errors: Vec<String>,
}

/// Procesos críticos del sistema Windows que nunca pueden cerrarse desde DiskVault Clean.
const PROTECTED_PROCESS_NAMES: &[&str] = &[
    "system",
    "idle",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "svchost.exe",
    "explorer.exe",
    "dwm.exe",
    "diskvault-clean.exe",
];

/// Lista negra estricta de fabricantes o carpetas genéricas que NUNCA deben proponerse como residuo.
const GENERIC_VENDOR_BLACKLIST: &[&str] = &[
    "microsoft",
    "windows",
    "google",
    "adobe",
    "apple",
    "intel",
    "amd",
    "nvidia",
    "valve",
    "steam",
    "common",
    "temp",
    "cache",
    "programs",
    "appdata",
    "local",
    "roaming",
    "shared",
    "system",
    "users",
    "windowsapps",
    "packages",
    "default",
    "public",
    "programdata",
    "program files",
    "program files (x86)",
    "mozilla",
    "oracle",
    "java",
    "python",
];

/// Valida si un nombre de carpeta es suficientemente específico y seguro para considerarlo residuo de una app.
pub fn is_allowed_leftover_name(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    if normalized.len() < 4 {
        return false;
    }
    if normalized.contains('\\') || normalized.contains('/') || normalized.contains("..") {
        return false;
    }
    !GENERIC_VENDOR_BLACKLIST.contains(&normalized.as_str())
}

/// Parsea `UninstallString` del Registro en `(ejecutable, argumentos)`.
///
/// Soporta:
/// - Rutas con espacios entre comillas + argumentos (`"C:\Program Files\App\unins.exe" /SILENT`)
/// - Comandos `MsiExec.exe /I{GUID}` convirtiendo `/I` automáticamente a `/X` (desinstalar)
/// - Rutas sin comillas con espacios terminadas en `.exe` + argumentos
/// - Rutas simples sin espacios
pub fn parse_uninstall_command(raw: &str) -> Result<(String, Vec<String>), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("La aplicación no tiene un comando de desinstalación válido.".to_string());
    }

    let (exe, rest) = if let Some(after_quote) = trimmed.strip_prefix('"') {
        let close = after_quote.find('"').ok_or_else(|| {
            "El comando de desinstalación del Registro tiene comillas sin cerrar.".to_string()
        })?;
        let exe_part = after_quote[..close].trim().to_string();
        let rest_part = after_quote[close + 1..].trim();
        (exe_part, rest_part)
    } else {
        // Busca si hay un `.exe` seguido de fin de cadena o espacio (para rutas sin comillas con espacios)
        let lower = trimmed.to_ascii_lowercase();
        if let Some(exe_idx) = lower.find(".exe") {
            let end_of_exe = exe_idx + 4;
            let next_char = trimmed.as_bytes().get(end_of_exe).copied();
            if next_char.is_none() || next_char == Some(b' ') || next_char == Some(b'\t') {
                let exe_part = trimmed[..end_of_exe].trim().to_string();
                let rest_part = trimmed[end_of_exe..].trim();
                (exe_part, rest_part)
            } else {
                split_first_whitespace(trimmed)
            }
        } else {
            split_first_whitespace(trimmed)
        }
    };

    if exe.is_empty() {
        return Err("No se pudo identificar el ejecutable del desinstalador.".to_string());
    }

    let mut args = split_command_args(rest);

    // Si es MsiExec.exe con `/I{GUID}` o `/I` (modo reparar/instalar), convertir a `/X` (desinstalar)
    let is_msiexec = exe.to_ascii_lowercase().ends_with("msiexec.exe")
        || exe.eq_ignore_ascii_case("msiexec");
    if is_msiexec {
        for arg in &mut args {
            if arg.eq_ignore_ascii_case("/i") || arg.eq_ignore_ascii_case("-i") {
                *arg = "/X".to_string();
            } else if arg.len() > 2
                && (arg[..2].eq_ignore_ascii_case("/i") || arg[..2].eq_ignore_ascii_case("-i"))
            {
                *arg = format!("/X{}", &arg[2..]);
            }
        }
    }

    Ok((exe, args))
}

fn split_first_whitespace(input: &str) -> (String, &str) {
    match input.find(char::is_whitespace) {
        Some(idx) => (input[..idx].trim().to_string(), input[idx..].trim()),
        None => (input.trim().to_string(), ""),
    }
}

fn split_command_args(rest: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in rest.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }

    if !current.is_empty() {
        args.push(current);
    }

    args
}

/// Busca procesos activos cuyo ejecutable resida dentro de la carpeta de instalación de la app.
pub fn find_running_processes_in_dir(dir_paths: &[&str]) -> Vec<RunningProcessInfo> {
    let normalized_roots: Vec<String> = dir_paths
        .iter()
        .map(|s| {
            let mut n = s.trim().replace('/', "\\").to_ascii_lowercase();
            while n.len() > 3 && n.ends_with('\\') {
                n.pop();
            }
            n
        })
        .filter(|s| s.len() > 3)
        .collect();

    if normalized_roots.is_empty() {
        return Vec::new();
    }

    let self_pid = std::process::id();
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut running = Vec::new();
    for (pid, proc_info) in sys.processes() {
        if pid.as_u32() == self_pid {
            continue;
        }
        let Some(exe) = proc_info.exe() else {
            continue;
        };
        let exe_norm = exe.to_string_lossy().replace('/', "\\").to_ascii_lowercase();

        let belongs = normalized_roots.iter().any(|root| {
            exe_norm == *root || exe_norm.starts_with(&format!("{root}\\"))
        });

        if belongs {
            running.push(RunningProcessInfo {
                pid: pid.as_u32(),
                name: proc_info.name().to_string_lossy().to_string(),
                exe_path: exe.to_string_lossy().to_string(),
                memory_bytes: proc_info.memory(),
            });
        }
    }

    running.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));
    running
}

pub fn check_app_running_processes(
    app_id: &str,
    apps_state: &AppsState,
) -> Result<Vec<RunningProcessInfo>, String> {
    let app = lookup_app(app_id, apps_state)?;
    let mut dirs_to_check: Vec<&str> = Vec::new();
    if let Some(ref loc) = app.install_location {
        dirs_to_check.push(loc.as_str());
    }
    if let Some(ref target) = app.relocated_target {
        dirs_to_check.push(target.as_str());
    }
    Ok(find_running_processes_in_dir(&dirs_to_check))
}

/// Cierra de forma segura los procesos solicitados, bloqueando procesos críticos de Windows y DiskVault Clean.
pub fn close_app_processes(pids: &[u32]) -> Result<u32, String> {
    if pids.is_empty() {
        return Ok(0);
    }

    let self_pid = std::process::id();
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut closed_count = 0u32;
    for &pid_u32 in pids {
        if pid_u32 == self_pid || pid_u32 <= 4 {
            continue;
        }
        let pid = Pid::from_u32(pid_u32);
        if let Some(proc_info) = sys.process(pid) {
            let pname = proc_info.name().to_string_lossy().to_ascii_lowercase();
            if PROTECTED_PROCESS_NAMES.contains(&pname.as_str()) {
                continue;
            }
            if proc_info.kill() {
                closed_count += 1;
            }
        }
    }

    Ok(closed_count)
}

fn lookup_app(app_id: &str, apps_state: &AppsState) -> Result<InstalledApp, String> {
    let guard = apps_state
        .apps
        .read()
        .map_err(|_| "No se pudo leer el inventario de aplicaciones en memoria.".to_string())?;
    guard
        .get(app_id)
        .cloned()
        .ok_or_else(|| "No se encontró la aplicación seleccionada. Actualiza la lista e inténtalo de nuevo.".to_string())
}

fn is_valid_appx_package_name(pkg: &str) -> bool {
    !pkg.is_empty()
        && pkg.len() <= 256
        && pkg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '~'))
}

/// Lanza el desinstalador oficial (Win32 o UWP Appx) y espera a que finalice.
pub fn run_uninstaller_process(app: &InstalledApp) -> Result<UninstallExecutionResult, String> {
    // Las apps instaladas a nivel máquina (HKLM) requieren Modo Administrador para desinstalar limpio
    if matches!(app.registry_hive.as_deref(), Some("HKLM64") | Some("HKLM32"))
        && !uac::is_running_as_admin()
    {
        return Err(
            "NEEDS_ADMIN: Esta aplicación está instalada para todo el equipo y requiere activar el Modo Administrador para desinstalarse."
                .to_string(),
        );
    }

    if app.app_type == "uwp" {
        let pkg = app.package_full_name.as_deref().ok_or_else(|| {
            "No se encontró el identificador PackageFullName de esta aplicación de Store."
                .to_string()
        })?;
        if !is_valid_appx_package_name(pkg) {
            return Err("El identificador de paquete Appx contiene caracteres no válidos.".to_string());
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;

            let status = Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    &format!("Remove-AppxPackage -Package '{pkg}'"),
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map_err(|err| format!("No se pudo ejecutar Remove-AppxPackage: {err}"))?;

            let ok = status.success();
            return Ok(UninstallExecutionResult {
                app_id: app.id.clone(),
                app_name: app.name.clone(),
                exit_code: status.code(),
                completed: ok,
                message: if ok {
                    format!("'{}' fue desinstalada correctamente.", app.name)
                } else {
                    format!(
                        "El desinstalador de Microsoft Store finalizó con código {:?}.",
                        status.code()
                    )
                },
            });
        }

        #[cfg(not(windows))]
        {
            return Err(
                "La desinstalación de aplicaciones solo está disponible en Windows.".to_string(),
            );
        }
    }

    // Aplicación Win32 clásica
    let raw_cmd = app
        .uninstall_string
        .as_deref()
        .or(app.quiet_uninstall_string.as_deref())
        .ok_or_else(|| {
            "Esta aplicación no registró un comando de desinstalación en Windows.".to_string()
        })?;

    let (exe, args) = parse_uninstall_command(raw_cmd)?;

    let status = Command::new(&exe)
        .args(&args)
        .status()
        .map_err(|err| {
            format!(
                "No se pudo iniciar el desinstalador oficial ('{exe}'): {err}. Verifica si requiere Modo Administrador."
            )
        })?;

    let exit_code = status.code();
    let completed = status.success() || exit_code == Some(0) || exit_code == Some(3010);

    Ok(UninstallExecutionResult {
        app_id: app.id.clone(),
        app_name: app.name.clone(),
        exit_code,
        completed,
        message: if completed {
            format!("El desinstalador de '{}' finalizó correctamente.", app.name)
        } else {
            format!(
                "El desinstalador de '{}' se cerró (código {:?}). Puedes comprobar si quedaron residuos.",
                app.name, exit_code
            )
        },
    })
}

fn compute_dir_size(path: &Path) -> u64 {
    if path.is_file() {
        return path.metadata().map(|m| m.len()).unwrap_or(0);
    }
    let mut sum = 0u64;
    for entry in WalkDir::new(path).follow_links(false).skip_hidden(false) {
        if let Ok(item) = entry {
            if item.file_type().is_file() {
                if let Ok(meta) = item.metadata() {
                    sum = sum.saturating_add(meta.len());
                }
            }
        }
    }
    sum
}

/// Construye la lista de rutas candidatas seguras en disco para el escáner de residuos
/// (función pura y testeable que garantiza cero falsos positivos con fabricantes genéricos).
pub fn build_safe_leftover_candidates(
    app_name: &str,
    publisher: Option<&str>,
    old_install_location: Option<&str>,
    appdata_roaming: Option<&Path>,
    appdata_local: Option<&Path>,
    programdata: Option<&Path>,
) -> Vec<(PathBuf, &'static str, String)> {
    let mut candidates: Vec<(PathBuf, &'static str, String)> = Vec::new();
    let mut seen_lower: Vec<String> = Vec::new();

    let mut push_unique = |path: PathBuf, risk: &'static str, reason: String| {
        if security::is_protected_path(&path) || !is_safe_specific_install_path(&path) {
            return;
        }
        // Protege además que el nombre final de la carpeta no sea un nombre genérico de fabricante
        if let Some(leaf) = path.file_name().and_then(|n| n.to_str()) {
            if !is_allowed_leftover_name(leaf) {
                return;
            }
        } else {
            return;
        }

        let norm = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
        if !seen_lower.contains(&norm) {
            seen_lower.push(norm);
            candidates.push((path, risk, reason));
        }
    };

    // 1. Carpeta original de instalación si aún existe
    if let Some(old_loc) = old_install_location {
        let p = PathBuf::from(old_loc.trim());
        push_unique(
            p,
            "safe",
            "Carpeta residual que quedó en la ubicación de instalación original.".to_string(),
        );
    }

    // 2. Solo buscar por nombre de app si cumple la regla estricta anti-falsos-positivos
    let clean_app = app_name.trim();
    if !is_allowed_leftover_name(clean_app) {
        return candidates;
    }

    let clean_pub = publisher
        .map(str::trim)
        .filter(|p| p.len() >= 3 && !p.contains('\\') && !p.contains('/'));

    let roots: [(Option<&Path>, &str, &str); 3] = [
        (
            appdata_local,
            "review",
            "Datos locales o caché de la aplicación en AppData\\Local (puede incluir perfiles).",
        ),
        (
            appdata_roaming,
            "review",
            "Configuración de usuario en AppData\\Roaming (puede contener ajustes o partidas guardadas).",
        ),
        (
            programdata,
            "safe",
            "Archivos compartidos sobrantes de la aplicación en ProgramData.",
        ),
    ];

    for (root_opt, risk, reason) in roots {
        let Some(root) = root_opt else {
            continue;
        };

        // %ROOT%\<app_name>
        push_unique(root.join(clean_app), risk, reason.to_string());

        // %ROOT%\<publisher>\<app_name> (nunca %ROOT%\<publisher> solo!)
        if let Some(pub_name) = clean_pub {
            if !pub_name.eq_ignore_ascii_case(clean_app) {
                push_unique(root.join(pub_name).join(clean_app), risk, reason.to_string());
            }
        }
    }

    candidates
}

/// Escanea residuos reales en disco y claves huérfanas específicas del Registro tras desinstalar.
pub fn scan_app_leftovers(
    app_name: &str,
    publisher: Option<&str>,
    old_install_location: Option<&str>,
    registry_hive: Option<&str>,
    registry_subkey: Option<&str>,
) -> Result<Vec<LeftoverItem>, String> {
    let roaming = dirs::config_dir();
    let local = dirs::data_local_dir();
    let programdata = std::env::var_os("ProgramData").map(PathBuf::from);

    let candidates = build_safe_leftover_candidates(
        app_name,
        publisher,
        old_install_location,
        roaming.as_deref(),
        local.as_deref(),
        programdata.as_deref(),
    );

    let mut results = Vec::new();
    for (idx, (path, base_risk, reason)) in candidates.into_iter().enumerate() {
        if !path.exists() {
            continue;
        }
        let size_bytes = compute_dir_size(&path);
        // Si la carpeta residual está prácticamente vacía (< 4 KB) o es de caché, clasificar como `safe`
        let path_lower = path.to_string_lossy().to_ascii_lowercase();
        let effective_risk = if base_risk == "safe" || size_bytes == 0 || path_lower.contains("cache")
        {
            "safe"
        } else {
            "review"
        };

        results.push(LeftoverItem {
            id: format!("fs:{idx}"),
            path: path.to_string_lossy().to_string(),
            item_type: if path.is_dir() {
                "folder".to_string()
            } else {
                "file".to_string()
            },
            size_bytes,
            risk: effective_risk.to_string(),
            reason,
            registry_hive: None,
            registry_key_path: None,
        });
    }

    // Claves huérfanas específicas en el Registro de Windows
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
        use winreg::RegKey;

        let clean_app = app_name.trim();
        if is_allowed_leftover_name(clean_app) {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let software_key = format!(r"Software\{clean_app}");
            if hkcu.open_subkey_with_flags(&software_key, KEY_READ).is_ok() {
                results.push(LeftoverItem {
                    id: "reg:hkcu_software".to_string(),
                    path: format!(r"HKCU\{software_key}"),
                    item_type: "registry".to_string(),
                    size_bytes: 0,
                    risk: "review".to_string(),
                    reason: "Clave de configuración residual en el Registro del usuario actual."
                        .to_string(),
                    registry_hive: Some("HKCU".to_string()),
                    registry_key_path: Some(software_key),
                });
            }
        }

        if let (Some(hive), Some(subkey)) = (registry_hive, registry_subkey) {
            let clean_sub = subkey.trim();
            if !clean_sub.is_empty() && !clean_sub.contains('\\') {
                let (root_opt, base_path) = match hive {
                    "HKLM64" => (
                        Some(RegKey::predef(HKEY_LOCAL_MACHINE)),
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                    ),
                    "HKLM32" => (
                        Some(RegKey::predef(HKEY_LOCAL_MACHINE)),
                        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
                    ),
                    "HKCU" => (
                        Some(RegKey::predef(HKEY_CURRENT_USER)),
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                    ),
                    _ => (None, ""),
                };

                if let Some(root) = root_opt {
                    let full_sub = format!(r"{base_path}\{clean_sub}");
                    if root.open_subkey_with_flags(&full_sub, KEY_READ).is_ok() {
                        results.push(LeftoverItem {
                            id: "reg:uninstall_orphan".to_string(),
                            path: format!(r"{hive}\{full_sub}"),
                            item_type: "registry".to_string(),
                            size_bytes: 0,
                            risk: "safe".to_string(),
                            reason: "Entrada de desinstalación huérfana en el Registro de Windows."
                                .to_string(),
                            registry_hive: Some(hive.to_string()),
                            registry_key_path: Some(full_sub),
                        });
                    }
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (registry_hive, registry_subkey);
    }

    // Ordena: seguros primero y mayor tamaño primero
    results.sort_by(|a, b| {
        let rank = |r: &str| if r == "safe" { 0 } else { 1 };
        rank(&a.risk)
            .cmp(&rank(&b.risk))
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });

    Ok(results)
}

/// Elimina de forma segura los residuos seleccionados (Papelera por defecto) y registra en SQLite.
pub fn clean_app_leftovers(
    items: &[LeftoverCleanRequest],
    use_recycle_bin: bool,
    db: &Database,
) -> Result<LeftoverCleanResult, String> {
    let mut cleaned_count = 0u32;
    let mut failed_count = 0u32;
    let mut bytes_freed = 0u64;
    let mut errors = Vec::new();

    for item in items {
        if item.item_type == "registry" {
            #[cfg(windows)]
            {
                use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
                use winreg::RegKey;

                let (Some(hive), Some(key_path)) = (
                    item.registry_hive.as_deref(),
                    item.registry_key_path.as_deref(),
                ) else {
                    failed_count += 1;
                    errors.push(format!("Clave de registro incompleta: {}", item.path));
                    continue;
                };

                let lower_key = key_path.to_ascii_lowercase();
                let allowed_prefix = lower_key.starts_with(r"software\")
                    && key_path.split('\\').count() >= 2;
                if !allowed_prefix {
                    failed_count += 1;
                    errors.push(format!(
                        "Clave bloqueada por seguridad: {}",
                        item.path
                    ));
                    continue;
                }

                let root = match hive {
                    "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
                    "HKLM64" | "HKLM32" => RegKey::predef(HKEY_LOCAL_MACHINE),
                    _ => {
                        failed_count += 1;
                        continue;
                    }
                };

                match root.delete_subkey_all(key_path) {
                    Ok(()) => cleaned_count += 1,
                    Err(err) => {
                        failed_count += 1;
                        errors.push(format!("No se pudo eliminar {}: {err}", item.path));
                    }
                }
            }
            continue;
        }

        // Residuo de sistema de archivos
        let target = Path::new(item.path.trim());
        if let Err(sec_err) = security::ensure_path_is_not_protected(target) {
            failed_count += 1;
            errors.push(sec_err);
            continue;
        }
        if !is_safe_specific_install_path(target) {
            failed_count += 1;
            errors.push(format!(
                "Ruta genérica bloqueada por seguridad: '{}'.",
                target.display()
            ));
            continue;
        }
        if !target.exists() {
            continue;
        }

        let item_size = compute_dir_size(target);
        let del_res = if use_recycle_bin {
            trash::delete(target).map_err(|e| e.to_string())
        } else if target.is_dir() {
            std::fs::remove_dir_all(target).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(target).map_err(|e| e.to_string())
        };

        match del_res {
            Ok(()) => {
                cleaned_count += 1;
                bytes_freed = bytes_freed.saturating_add(item_size);
            }
            Err(err) => {
                failed_count += 1;
                errors.push(format!(
                    "No se pudo eliminar '{}': {err}",
                    target.display()
                ));
            }
        }
    }

    if cleaned_count > 0 {
        let _ = db.record_audit_log(
            "apps",
            "clean_leftovers",
            None,
            if use_recycle_bin {
                Some("Papelera de Reciclaje")
            } else {
                None
            },
            i64::try_from(bytes_freed).unwrap_or(i64::MAX),
            if failed_count == 0 { "ok" } else { "warning" },
            Some(&format!(
                "Limpieza de residuos: {cleaned_count} elemento(s) limpiado(s), {failed_count} omitido(s)."
            )),
        );
    }

    Ok(LeftoverCleanResult {
        cleaned_count,
        failed_count,
        bytes_freed,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_safe_leftover_candidates, is_allowed_leftover_name, parse_uninstall_command,
    };
    use std::path::Path;

    #[test]
    fn parsea_uninstall_string_en_todos_los_formatos() {
        // 1. Ruta con espacios entre comillas + argumentos
        let (exe1, args1) =
            parse_uninstall_command(r#""C:\Program Files\Mi App\unins000.exe" /SILENT /NORESTART"#)
                .unwrap();
        assert_eq!(exe1, r"C:\Program Files\Mi App\unins000.exe");
        assert_eq!(args1, vec!["/SILENT", "/NORESTART"]);

        // 2. MsiExec.exe /I{GUID} convertido automáticamente a /X{GUID}
        let (exe2, args2) =
            parse_uninstall_command(r"MsiExec.exe /I{12345678-ABCD-1234-ABCD-1234567890AB}")
                .unwrap();
        assert_eq!(exe2, "MsiExec.exe");
        assert_eq!(args2, vec!["/X{12345678-ABCD-1234-ABCD-1234567890AB}"]);

        // 3. MsiExec separado: MsiExec.exe /I {GUID}
        let (exe3, args3) =
            parse_uninstall_command(r"msiexec.exe /i {AAAA-BBBB}").unwrap();
        assert_eq!(exe3, "msiexec.exe");
        assert_eq!(args3, vec!["/X", "{AAAA-BBBB}"]);

        // 4. Ruta simple sin comillas
        let (exe4, args4) = parse_uninstall_command(r"C:\Tools\App\uninstall.exe").unwrap();
        assert_eq!(exe4, r"C:\Tools\App\uninstall.exe");
        assert!(args4.is_empty());

        // 5. Ruta con espacios sin comillas + argumento
        let (exe5, args5) =
            parse_uninstall_command(r"C:\Program Files\Demo Tool\remove.exe --quiet").unwrap();
        assert_eq!(exe5, r"C:\Program Files\Demo Tool\remove.exe");
        assert_eq!(args5, vec!["--quiet"]);
    }

    #[test]
    fn escaner_de_residuos_nunca_incluye_fabricantes_genericos_ni_rutas_protegidas() {
        for forbidden in ["Microsoft", "Google", "Adobe", "Common", "Windows", "Steam", "App"] {
            assert!(
                !is_allowed_leftover_name(forbidden),
                "El nombre '{forbidden}' nunca debería permitirse como carpeta residual"
            );
        }

        let roaming = Path::new(r"C:\Users\Carlos\AppData\Roaming");
        let local = Path::new(r"C:\Users\Carlos\AppData\Local");
        let programdata = Path::new(r"C:\ProgramData");

        // Caso 1: App llamada "Microsoft" con ruta protegida -> debe devolver 0 candidatos
        let bad_candidates = build_safe_leftover_candidates(
            "Microsoft",
            Some("Microsoft"),
            Some(r"C:\Windows\System32"),
            Some(roaming),
            Some(local),
            Some(programdata),
        );
        assert!(bad_candidates.is_empty());

        // Caso 2: App legítima con fabricante genérico ("Google") -> jamás propone %APPDATA%\Google,
        // solo subcarpetas específicas %APPDATA%\Google\MiAppUnica
        let good_candidates = build_safe_leftover_candidates(
            "MiAppUnica",
            Some("Google"),
            Some(r"C:\Program Files\MiAppUnica"),
            Some(roaming),
            Some(local),
            Some(programdata),
        );

        assert!(!good_candidates.is_empty());
        for (path, _, _) in &good_candidates {
            let leaf = path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_ascii_lowercase();
            assert_eq!(leaf, "miappunica");
            assert!(!crate::security::is_protected_path(path));
        }
    }
}
