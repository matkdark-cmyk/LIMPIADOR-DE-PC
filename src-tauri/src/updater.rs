use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};
use url::Url;

/// Repositorio oficial de GitHub Releases para DiskVault Clean.
pub const GITHUB_REPO_OWNER: &str = "matkdark-cmyk";
pub const GITHUB_REPO_NAME: &str = "LIMPIADOR-DE-PC";

/// Bandera CLI interna para el modo asistente nativo de actualización (sin PowerShell).
pub const APPLY_UPDATE_FLAG: &str = "--apply-update";

const USER_AGENT: &str = concat!("DiskVaultClean/", env!("CARGO_PKG_VERSION"));

/// Hosts HTTPS permitidos para consultar y descargar actualizaciones desde GitHub Releases.
const ALLOWED_UPDATE_HOSTS: &[&str] = &[
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
    "codeload.github.com",
];

/// Resultado de la comprobación de actualizaciones frente a GitHub Releases.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_title: String,
    pub release_notes: String,
    pub published_at: Option<String>,
    pub release_url: String,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size_bytes: u64,
    pub checksums_url: Option<String>,
    pub is_portable_package: bool,
    pub portable_fallback_url: Option<String>,
    pub portable_fallback_name: Option<String>,
}

/// Evento de progreso emitido al frontend durante la descarga e instalación (`"update-progress"`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub stage: String, // "downloading" | "verifying" | "installing" | "error"
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub message: String,
}

/// Solicitud confirmada por el usuario para descargar, instalar y reiniciar automáticamente.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallUpdateRequest {
    pub version: String,
    pub download_url: String,
    pub asset_name: String,
    pub checksums_url: Option<String>,
    pub is_portable_package: bool,
    #[serde(default)]
    pub portable_fallback_url: Option<String>,
    #[serde(default)]
    pub portable_fallback_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    draft: Option<bool>,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
}

/// Configuración persistida en JSON para el proceso auxiliar nativo `DiskVaultUpdater.exe`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeUpdateConfig {
    old_pid: u32,
    payload_path: String,
    staging_dir: String,
    current_exe: String,
    app_dir: String,
    is_portable: bool,
    target_version: String,
    log_path: String,
    checksums_url: Option<String>,
    portable_fallback_url: Option<String>,
    portable_fallback_name: Option<String>,
}

/// Detecta si el proceso fue invocado en modo asistente nativo `--apply-update <ruta_json>`.
pub fn parse_apply_update_arg() -> Option<PathBuf> {
    let mut args = std::env::args_os().skip(1);
    while let Some(arg) = args.next() {
        if arg == APPLY_UPDATE_FLAG {
            if let Some(path) = args.next() {
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
    }
    None
}

/// Parsea una versión semántica simple (`v1.2.3` o `1.2.3-beta` -> `(1, 2, 3)`).
pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let cleaned = raw.trim().trim_start_matches(['v', 'V']);
    let core = cleaned.split(['-', '+']).next().unwrap_or(cleaned);
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

/// Indica si `candidate` es estrictamente mayor que `current`.
pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    match (parse_semver(current), parse_semver(candidate)) {
        (Some(cur), Some(cand)) => cand > cur,
        _ => false,
    }
}

/// Valida que la URL de actualización utilice exclusivamente HTTPS hacia hosts oficiales de GitHub.
pub fn validate_update_url(raw_url: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw_url.trim())
        .map_err(|_| "La dirección de descarga de la actualización no es válida.".to_string())?;

    if parsed.scheme() != "https" {
        return Err("Solo se permiten descargas de actualización mediante HTTPS seguro.".to_string());
    }

    let host = parsed
        .host_str()
        .map(|h| h.to_ascii_lowercase())
        .ok_or_else(|| "La URL de actualización no contiene un dominio válido.".to_string())?;

    let is_allowed = ALLOWED_UPDATE_HOSTS.iter().any(|allowed| host == *allowed)
        || host.ends_with(".githubusercontent.com");

    if !is_allowed {
        return Err(format!(
            "Descarga bloqueada por seguridad: el dominio '{host}' no pertenece a GitHub Releases."
        ));
    }

    Ok(parsed)
}

/// Parsea el contenido de `SHA256SUMS.txt` y busca el hash esperado para un nombre de archivo exacto.
pub fn extract_expected_sha256(checksums_text: &str, target_filename: &str) -> Option<String> {
    let wanted = target_filename.trim().to_ascii_lowercase();
    for line in checksums_text.lines() {
        let trimmed = line.trim().trim_start_matches('\u{feff}');
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        if hash.len() == 64
            && hash.chars().all(|c| c.is_ascii_hexdigit())
            && name.to_ascii_lowercase() == wanted
        {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

/// Valida y limpia un nombre de archivo de actualización para evitar path traversal.
fn sanitize_asset_filename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err("El nombre del archivo de actualización contiene caracteres no permitidos.".to_string());
    }
    Ok(trimmed.to_string())
}

fn build_http_client(timeout_secs: u64) -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|err| format!("No se pudo inicializar el cliente HTTPS de actualizaciones: {err}"))
}

fn compute_file_sha256(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

/// Elimina archivos `.old` y carpetas temporales antiguas `DiskVaultClean_Update_*` al iniciar la app.
pub fn cleanup_old_update_artifacts() {
    if let Ok(exe_path) = std::env::current_exe() {
        let mut old_os = exe_path.as_os_str().to_os_string();
        old_os.push(".old");
        let old_path = PathBuf::from(old_os);
        if old_path.exists() {
            let _ = fs::remove_file(&old_path);
        }
    }

    let temp_dir = std::env::temp_dir();
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        let my_prefix = format!("DiskVaultClean_Update_{}", std::process::id());
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("DiskVaultClean_Update_") && name != my_prefix {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// Comprueba si una ruta pertenece a `Program Files` / `Program Files (x86)` en Windows.
pub fn is_under_program_files(dir: &Path) -> bool {
    let normalized = dir
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();

    for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Ok(pf) = std::env::var(var) {
            let pf_norm = pf
                .replace('/', "\\")
                .trim_end_matches('\\')
                .to_ascii_lowercase();
            if !pf_norm.is_empty()
                && (normalized == pf_norm || normalized.starts_with(&format!("{pf_norm}\\")))
            {
                return true;
            }
        }
    }

    normalized.contains("\\program files\\") || normalized.contains("\\program files (x86)\\")
}

/// Construye los argumentos exactos para el instalador NSIS de Tauri v2.
/// Por especificación de NSIS, `/D=<ruta>` DEBE ir al final y SIN comillas aunque tenga espacios.
pub fn build_nsis_install_args(mode_flag: &str, scope_flag: &str, app_dir: &str) -> String {
    let clean_dir = app_dir.trim().trim_end_matches(['\\', '/']);
    let mut parts: Vec<&str> = Vec::new();
    if !mode_flag.trim().is_empty() {
        parts.push(mode_flag.trim());
    }
    if !scope_flag.trim().is_empty() {
        parts.push(scope_flag.trim());
    }
    if clean_dir.is_empty() {
        parts.join(" ")
    } else if parts.is_empty() {
        format!("/D={clean_dir}")
    } else {
        format!("{} /D={clean_dir}", parts.join(" "))
    }
}

/// Consulta la última versión publicada en GitHub Releases sin descargar binarios.
/// Si `/releases/latest` devuelve 404, consulta `/releases?per_page=10` como respaldo.
pub fn check_github_updates(is_portable: bool) -> Result<UpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let latest_api_url = format!(
        "https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/releases/latest"
    );
    validate_update_url(&latest_api_url)?;

    let client = build_http_client(20)?;
    let response = client
        .get(&latest_api_url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .map_err(|err| {
            format!("No se pudo contactar con GitHub para buscar actualizaciones: {err}")
        })?;

    let release_opt: Option<GitHubRelease> = if response.status().is_success() {
        let parsed: GitHubRelease = response
            .json()
            .map_err(|err| format!("No se pudo interpretar la respuesta de GitHub Releases: {err}"))?;
        if parsed.draft.unwrap_or(false) {
            None
        } else {
            Some(parsed)
        }
    } else if response.status().as_u16() == 404 {
        let list_url = format!(
            "https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/releases?per_page=10"
        );
        validate_update_url(&list_url)?;
        let list_resp = client
            .get(&list_url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .map_err(|err| {
                format!("No se pudo consultar la lista de versiones en GitHub: {err}")
            })?;

        if list_resp.status().is_success() {
            let releases: Vec<GitHubRelease> = list_resp.json().unwrap_or_default();
            releases
                .into_iter()
                .filter(|r| !r.draft.unwrap_or(false))
                .max_by_key(|r| parse_semver(&r.tag_name).unwrap_or((0, 0, 0)))
        } else {
            None
        }
    } else {
        return Err(format!(
            "GitHub respondió con estado HTTP {} al comprobar actualizaciones.",
            response.status().as_u16()
        ));
    };

    let Some(release) = release_opt else {
        return Ok(UpdateCheckResult {
            update_available: false,
            current_version: current_version.clone(),
            latest_version: current_version,
            release_title: "Sin publicaciones disponibles todavía".to_string(),
            release_notes: String::new(),
            published_at: None,
            release_url: format!(
                "https://github.com/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/releases"
            ),
            download_url: None,
            asset_name: None,
            asset_size_bytes: 0,
            checksums_url: None,
            is_portable_package: is_portable,
            portable_fallback_url: None,
            portable_fallback_name: None,
        });
    };

    let latest_version = release
        .tag_name
        .trim()
        .trim_start_matches(['v', 'V'])
        .to_string();

    let portable_asset = release.assets.iter().find(|a| {
        let lower = a.name.to_ascii_lowercase();
        lower.ends_with(".zip") && lower.contains("portable")
    });

    let installer_asset = release.assets.iter().find(|a| {
        let lower = a.name.to_ascii_lowercase();
        lower.ends_with(".exe") && (lower.contains("setup") || lower.contains("diskvault"))
    });

    let matched_asset = if is_portable {
        portable_asset
    } else {
        installer_asset.or(portable_asset)
    };

    let checksums_asset = release
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"));

    let update_available =
        is_newer_version(&current_version, &latest_version) && matched_asset.is_some();

    let notes = release.body.unwrap_or_default().trim().to_string();

    let release_title = release
        .name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("DiskVault Clean v{latest_version}"));

    Ok(UpdateCheckResult {
        update_available,
        current_version,
        latest_version,
        release_title,
        release_notes: if notes.is_empty() {
            "Esta actualización incluye mejoras de estabilidad, seguridad y rendimiento para DiskVault Clean."
                .to_string()
        } else {
            notes
        },
        published_at: release.published_at,
        release_url: release.html_url,
        download_url: matched_asset.map(|a| a.browser_download_url.clone()),
        asset_name: matched_asset.map(|a| a.name.clone()),
        asset_size_bytes: matched_asset.map(|a| a.size).unwrap_or(0),
        checksums_url: checksums_asset.map(|a| a.browser_download_url.clone()),
        is_portable_package: is_portable,
        portable_fallback_url: portable_asset.map(|a| a.browser_download_url.clone()),
        portable_fallback_name: portable_asset.map(|a| a.name.clone()),
    })
}

fn emit_update_progress(
    app_handle: &AppHandle,
    stage: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    message: &str,
) {
    let percent = if total_bytes > 0 {
        ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    let _ = app_handle.emit(
        "update-progress",
        UpdateProgressEvent {
            stage: stage.to_string(),
            downloaded_bytes,
            total_bytes,
            percent,
            message: message.to_string(),
        },
    );
}

fn download_verified_file(
    client: &Client,
    download_url: &str,
    asset_name: &str,
    dest_path: &Path,
    checksums_url: Option<&str>,
    app_handle: Option<&AppHandle>,
) -> Result<u64, String> {
    validate_update_url(download_url)?;
    if let Some(cs_url) = checksums_url {
        validate_update_url(cs_url)?;
    }

    let mut response = client
        .get(download_url)
        .send()
        .map_err(|err| format!("Error al descargar la actualización: {err}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "No se pudo descargar el paquete (HTTP {}).",
            response.status().as_u16()
        ));
    }

    // Verificar destino final tras redirecciones de GitHub CDN
    validate_update_url(response.url().as_str())?;

    let total_bytes = response.content_length().unwrap_or(0);
    let mut out_file = File::create(dest_path)
        .map_err(|err| format!("No se pudo crear el archivo temporal de descarga: {err}"))?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 128 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let mut emitted_first_chunk = false;

    loop {
        let read_n = response
            .read(&mut buffer)
            .map_err(|err| format!("Se interrumpió la descarga de la actualización: {err}"))?;
        if read_n == 0 {
            break;
        }
        let chunk = &buffer[..read_n];
        out_file
            .write_all(chunk)
            .map_err(|err| format!("No se pudo escribir el archivo de actualización: {err}"))?;
        hasher.update(chunk);
        downloaded = downloaded.saturating_add(read_n as u64);

        if let Some(handle) = app_handle {
            if !emitted_first_chunk || last_emit.elapsed() >= Duration::from_millis(60) {
                emit_update_progress(
                    handle,
                    "downloading",
                    downloaded,
                    total_bytes,
                    &format!("Descargando {asset_name}..."),
                );
                emitted_first_chunk = true;
                last_emit = Instant::now();
            }
        }
    }

    out_file
        .flush()
        .map_err(|err| format!("No se pudo completar la escritura del paquete: {err}"))?;
    drop(out_file);

    if downloaded == 0 || (total_bytes > 0 && downloaded != total_bytes) {
        let _ = fs::remove_file(dest_path);
        return Err(
            "La descarga quedó incompleta. Comprueba tu conexión e inténtalo de nuevo.".to_string(),
        );
    }

    if let Some(handle) = app_handle {
        emit_update_progress(
            handle,
            "verifying",
            downloaded,
            total_bytes.max(downloaded),
            "Descarga completada (100%). Verificando firma SHA-256...",
        );
    }

    // Verificar hash SHA-256 si el Release publicó SHA256SUMS.txt
    let actual_hash = format!("{:x}", hasher.finalize());
    if let Some(cs_url) = checksums_url {
        if let Ok(cs_resp) = client.get(cs_url).send() {
            if cs_resp.status().is_success() {
                if let Ok(cs_text) = cs_resp.text() {
                    if let Some(expected_hash) = extract_expected_sha256(&cs_text, asset_name) {
                        if expected_hash != actual_hash {
                            let _ = fs::remove_file(dest_path);
                            return Err(
                                "La verificación de integridad SHA-256 falló: el archivo descargado no coincide con la firma oficial del Release. Se canceló la instalación por seguridad."
                                    .to_string(),
                            );
                        }
                    }
                }
            }
        }
    }

    Ok(downloaded)
}

/// Descarga el paquete confirmado, verifica su SHA-256, lanza una copia nativa
/// del propio ejecutable (`DiskVaultUpdater.exe --apply-update ...`, CERO PowerShell)
/// y cierra la instancia actual para reiniciarse en la última versión.
pub fn download_and_apply_update(
    app_handle: &AppHandle,
    req: &InstallUpdateRequest,
    is_portable: bool,
    logs_dir: &Path,
) -> Result<(), String> {
    let safe_filename = sanitize_asset_filename(&req.asset_name)?;
    validate_update_url(&req.download_url)?;
    if let Some(ref cs_url) = req.checksums_url {
        validate_update_url(cs_url)?;
    }
    if let Some(ref fallback_url) = req.portable_fallback_url {
        validate_update_url(fallback_url)?;
    }

    let client = build_http_client(300)?;

    // 1. Preparar carpeta temporal aislada
    let staging_dir = std::env::temp_dir().join(format!(
        "DiskVaultClean_Update_{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&staging_dir);
    fs::create_dir_all(&staging_dir)
        .map_err(|err| format!("No se pudo crear la carpeta temporal de actualización: {err}"))?;

    let payload_path = staging_dir.join(&safe_filename);

    emit_update_progress(
        app_handle,
        "downloading",
        0,
        0,
        &format!("Conectando con GitHub para descargar v{}...", req.version),
    );

    let downloaded = download_verified_file(
        &client,
        &req.download_url,
        &safe_filename,
        &payload_path,
        req.checksums_url.as_deref(),
        Some(app_handle),
    )?;

    emit_update_progress(
        app_handle,
        "installing",
        downloaded,
        downloaded,
        &format!(
            "Descarga verificada. Instalando v{} y reiniciando automáticamente...",
            req.version
        ),
    );

    // 2. Lanzar el actualizador nativo en Rust (cero PowerShell, cero scripts bloqueados por AV)
    launch_windows_native_updater(
        &payload_path,
        &staging_dir,
        is_portable,
        req,
        logs_dir,
    )?;

    // 3. Dar tiempo visible a la UI para mostrar 100% y asegurar que el helper ya está esperando
    std::thread::sleep(Duration::from_millis(800));
    app_handle.exit(0);
    Ok(())
}

#[cfg(windows)]
fn can_write_to_dir(dir: &Path) -> bool {
    let probe = dir.join(format!(".dv_update_probe_{}.tmp", std::process::id()));
    match File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[cfg(windows)]
fn shell_execute_windows(
    verb: &str,
    exe_path: &Path,
    params: Option<&str>,
    work_dir: Option<&Path>,
    show_window: bool,
) -> Result<(), (isize, u32)> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, HWND};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::{SW_HIDE, SW_SHOWNORMAL};

    let to_wide = |value: &OsStr| -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    };

    let verb_w = to_wide(OsStr::new(verb));
    let exe_w = to_wide(exe_path.as_os_str());
    let params_w = params.map(|p| to_wide(OsStr::new(p)));
    let dir_w = work_dir.map(|d| to_wide(d.as_os_str()));

    let show_cmd = if show_window { SW_SHOWNORMAL } else { SW_HIDE };

    let result = unsafe {
        ShellExecuteW(
            HWND::default(),
            PCWSTR(verb_w.as_ptr()),
            PCWSTR(exe_w.as_ptr()),
            params_w
                .as_ref()
                .map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr())),
            dir_w
                .as_ref()
                .map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr())),
            show_cmd,
        )
    };

    let code = result.0 as isize;
    if code > 32 {
        Ok(())
    } else {
        let err = unsafe { GetLastError() };
        Err((code, err.0))
    }
}

#[cfg(windows)]
fn launch_windows_native_updater(
    payload_path: &Path,
    staging_dir: &Path,
    is_portable: bool,
    req: &InstallUpdateRequest,
    logs_dir: &Path,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use windows::Win32::Foundation::ERROR_CANCELLED;

    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    let current_exe = std::env::current_exe().map_err(|err| {
        format!("No se pudo determinar la ruta del ejecutable actual para reiniciar: {err}")
    })?;
    let app_dir = current_exe
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta del ejecutable actual.".to_string())?;

    let _ = fs::create_dir_all(logs_dir);
    let log_path = logs_dir.join("updater.log");

    // Copiar nuestro propio ejecutable nativo a la carpeta temporal para que pueda reemplazar
    // al original sin bloqueos de archivo y SIN depender de PowerShell ni scripts .ps1/.bat.
    let helper_exe = staging_dir.join("DiskVaultUpdater.exe");
    fs::copy(&current_exe, &helper_exe).map_err(|err| {
        format!("No se pudo preparar el ejecutable auxiliar de actualización: {err}")
    })?;

    let config_path = staging_dir.join("update_config.json");
    let config = NativeUpdateConfig {
        old_pid: std::process::id(),
        payload_path: payload_path.to_string_lossy().to_string(),
        staging_dir: staging_dir.to_string_lossy().to_string(),
        current_exe: current_exe.to_string_lossy().to_string(),
        app_dir: app_dir.to_string_lossy().to_string(),
        is_portable,
        target_version: req.version.trim().trim_start_matches(['v', 'V']).to_string(),
        log_path: log_path.to_string_lossy().to_string(),
        checksums_url: req.checksums_url.clone(),
        portable_fallback_url: req.portable_fallback_url.clone(),
        portable_fallback_name: req.portable_fallback_name.clone(),
    };

    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|err| format!("No se pudo serializar la configuración de actualización: {err}"))?;
    fs::write(&config_path, config_json.as_bytes())
        .map_err(|err| format!("No se pudo guardar la configuración de actualización: {err}"))?;

    // Si la carpeta de instalación requiere Administrador y no estamos elevados aún,
    // pedimos elevación UAC AHORA (con la ventana visible) antes de cerrar la app.
    let needs_elevation =
        !crate::uac::is_running_as_admin() && (!can_write_to_dir(app_dir) || is_under_program_files(app_dir));

    if needs_elevation {
        let params = format!("{APPLY_UPDATE_FLAG} \"{}\"", config_path.display());
        match shell_execute_windows("runas", &helper_exe, Some(&params), Some(staging_dir), false) {
            Ok(()) => return Ok(()),
            Err((code, err_code)) => {
                if err_code == ERROR_CANCELLED.0 || code == 5 {
                    return Err(
                        "Se canceló el permiso de Administrador (UAC) necesario para actualizar la aplicación. No se cerró DiskVault Clean."
                            .to_string(),
                    );
                }
                return Err(format!(
                    "No se pudo iniciar el actualizador nativo como Administrador (código {code}, detalle {err_code})."
                ));
            }
        }
    }

    Command::new(&helper_exe)
        .arg(APPLY_UPDATE_FLAG)
        .arg(&config_path)
        .current_dir(staging_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|err| format!("No se pudo iniciar el actualizador nativo: {err}"))?;

    Ok(())
}

#[cfg(not(windows))]
fn launch_windows_native_updater(
    _payload_path: &Path,
    _staging_dir: &Path,
    _is_portable: bool,
    _req: &InstallUpdateRequest,
    _logs_dir: &Path,
) -> Result<(), String> {
    Err("La instalación automática con reinicio solo está disponible en Windows.".to_string())
}

// ==================== EJECUCIÓN DEL ASISTENTE NATIVO (--apply-update) ====================

fn append_updater_log(log_path: &Path, message: &str) {
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(file, "[{ts}] {message}");
    }
}

/// Extrae el ejecutable principal (`.exe` más grande) y opcionalmente `LEEME_PORTABLE.txt`
/// desde un paquete `.zip` oficial en Rust puro (sin PowerShell).
fn extract_exe_from_portable_zip(
    zip_path: &Path,
    extract_dir: &Path,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let _ = fs::remove_dir_all(extract_dir);
    fs::create_dir_all(extract_dir)
        .map_err(|err| format!("No se pudo crear carpeta de extracción: {err}"))?;

    let zip_file = File::open(zip_path)
        .map_err(|err| format!("No se pudo abrir el paquete ZIP: {err}"))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|err| format!("El archivo ZIP de actualización es inválido: {err}"))?;

    let mut best_exe: Option<(PathBuf, u64)> = None;
    let mut readme_path: Option<PathBuf> = None;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|err| format!("No se pudo leer entrada del ZIP: {err}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(safe_rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out_path = extract_dir.join(&safe_rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("No se pudo crear subcarpeta de extracción: {err}"))?;
        }
        let mut out = File::create(&out_path)
            .map_err(|err| format!("No se pudo extraer archivo del ZIP: {err}"))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|err| format!("Error al descomprimir archivo del ZIP: {err}"))?;
        drop(out);

        let file_name_lower = out_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if file_name_lower.ends_with(".exe") {
            let size = fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
            if best_exe.as_ref().map_or(true, |(_, best_sz)| size > *best_sz) {
                best_exe = Some((out_path, size));
            }
        } else if file_name_lower == "leeme_portable.txt" {
            readme_path = Some(out_path);
        }
    }

    let (exe_path, _) = best_exe.ok_or_else(|| {
        "El paquete ZIP de actualización no contenía ningún ejecutable (.exe).".to_string()
    })?;

    Ok((exe_path, readme_path))
}

/// Reemplaza de forma atómica un archivo ejecutable en Windows (con respaldo `.old` si sigue bloqueado).
fn replace_executable_atomically(source_exe: &Path, dest_exe: &Path) -> bool {
    let expected_hash = compute_file_sha256(source_exe);

    for _ in 0..20 {
        if fs::copy(source_exe, dest_exe).is_ok() {
            if expected_hash.is_none() || compute_file_sha256(dest_exe) == expected_hash {
                return true;
            }
        }

        // En Windows un .exe recién cerrado o bloqueado se puede renombrar a .old y colocar el nuevo
        let mut old_os = dest_exe.as_os_str().to_os_string();
        old_os.push(".old");
        let old_backup = PathBuf::from(old_os);
        let _ = fs::remove_file(&old_backup);

        if dest_exe.exists() && fs::rename(dest_exe, &old_backup).is_ok() {
            if fs::copy(source_exe, dest_exe).is_ok() {
                if expected_hash.is_none() || compute_file_sha256(dest_exe) == expected_hash {
                    return true;
                }
            } else {
                // Restaurar si falló la copia
                let _ = fs::rename(&old_backup, dest_exe);
            }
        }

        std::thread::sleep(Duration::from_millis(350));
    }

    false
}

#[cfg(windows)]
fn wait_for_old_process_exit(old_pid: u32, log_path: &Path) {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };

    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, false, old_pid) {
            let wait_res = WaitForSingleObject(handle, 8_000);
            if wait_res != WAIT_OBJECT_0 {
                append_updater_log(
                    log_path,
                    &format!("PID {old_pid} seguía activo tras 8s; cerrando proceso limpiamente."),
                );
                let _ = TerminateProcess(handle, 0);
                let _ = WaitForSingleObject(handle, 3_000);
            }
            let _ = CloseHandle(handle);
        }
    }

    // Dar margen al sistema de archivos y a WebView2 para soltar todos los handles
    std::thread::sleep(Duration::from_millis(800));
}

#[cfg(windows)]
fn find_updated_installed_exe(
    current_exe: &Path,
    app_dir: &Path,
    old_hash: Option<&str>,
    install_started_at: SystemTime,
) -> Option<PathBuf> {
    // 1. Comprobar primero el propio ejecutable original
    if current_exe.exists() {
        if let (Some(old), Some(cur)) = (old_hash, compute_file_sha256(current_exe)) {
            if cur != old {
                return Some(current_exe.to_path_buf());
            }
        }
    }

    // 2. Comprobar rutas estándar de NSIS por si el instalador escribió en otra carpeta
    let mut dirs: Vec<PathBuf> = vec![app_dir.to_path_buf()];
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        dirs.push(PathBuf::from(&local_app).join("DiskVault Clean"));
        dirs.push(PathBuf::from(&local_app).join("Programs").join("DiskVault Clean"));
    }
    for pf_var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Ok(pf) = std::env::var(pf_var) {
            dirs.push(PathBuf::from(pf).join("DiskVault Clean"));
        }
    }

    let current_name = current_exe
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("diskvault-clean.exe")
        .to_string();
    let exe_names = [
        current_name.as_str(),
        "diskvault-clean.exe",
        "DiskVault Clean.exe",
        "DiskVaultClean.exe",
    ];

    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }
        for name in exe_names {
            let cand = dir.join(name);
            if !cand.is_file() {
                continue;
            }
            let modified_recently = fs::metadata(&cand)
                .and_then(|m| m.modified())
                .map(|m| m >= install_started_at)
                .unwrap_or(false);
            let hash_changed = match (old_hash, compute_file_sha256(&cand)) {
                (Some(old), Some(cur)) => cur != old,
                (None, Some(_)) => true,
                _ => false,
            };
            if hash_changed && (modified_recently || cand != current_exe) {
                return Some(cand);
            }
        }
    }

    None
}

#[cfg(windows)]
fn relaunch_updated_executable(launch_exe: &Path, log_path: &Path) {
    use std::process::Command;

    let work_dir = launch_exe.parent();
    append_updater_log(
        log_path,
        &format!("Relanzando aplicación actualizada: {}", launch_exe.display()),
    );

    if let Err((code, err)) = shell_execute_windows("open", launch_exe, None, work_dir, true) {
        append_updater_log(
            log_path,
            &format!("ShellExecuteW('open') devolvió código {code} (err {err}); probando Command::spawn"),
        );
        let mut cmd = Command::new(launch_exe);
        if let Some(dir) = work_dir {
            cmd.current_dir(dir);
        }
        if let Err(spawn_err) = cmd.spawn() {
            append_updater_log(
                log_path,
                &format!("ERROR al relanzar {}: {spawn_err}", launch_exe.display()),
            );
        }
    }
}

/// Punto de entrada del proceso auxiliar nativo `DiskVaultUpdater.exe --apply-update <config.json>`.
#[cfg(windows)]
pub fn run_native_updater_helper(config_path: &Path) {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let Ok(raw) = fs::read_to_string(config_path) else {
        return;
    };
    let Ok(cfg) = serde_json::from_str::<NativeUpdateConfig>(&raw) else {
        return;
    };

    let log_path = PathBuf::from(&cfg.log_path);
    let payload_path = PathBuf::from(&cfg.payload_path);
    let staging_dir = PathBuf::from(&cfg.staging_dir);
    let current_exe = PathBuf::from(&cfg.current_exe);
    let app_dir = PathBuf::from(&cfg.app_dir);

    append_updater_log(
        &log_path,
        &format!(
            "=== Inicio actualizador nativo v{} (portable={}) ===",
            cfg.target_version, cfg.is_portable
        ),
    );
    append_updater_log(
        &log_path,
        &format!(
            "Ejecutable actual: {} | Paquete: {}",
            current_exe.display(),
            payload_path.display()
        ),
    );

    let old_hash = compute_file_sha256(&current_exe);
    wait_for_old_process_exit(cfg.old_pid, &log_path);

    let mut launch_exe = current_exe.clone();
    let install_started_at = SystemTime::now()
        .checked_sub(Duration::from_secs(2))
        .unwrap_or_else(SystemTime::now);

    if cfg.is_portable || cfg.payload_path.to_ascii_lowercase().ends_with(".zip") {
        let extract_dir = staging_dir.join("extracted");
        match extract_exe_from_portable_zip(&payload_path, &extract_dir) {
            Ok((new_exe, readme_opt)) => {
                let replaced = replace_executable_atomically(&new_exe, &current_exe);
                append_updater_log(
                    &log_path,
                    &format!("Reemplazo binario portable en {}: {replaced}", current_exe.display()),
                );
                if let Some(readme_src) = readme_opt {
                    let _ = fs::copy(readme_src, app_dir.join("LEEME_PORTABLE.txt"));
                }
            }
            Err(err) => {
                append_updater_log(&log_path, &format!("Error extrayendo ZIP portable: {err}"));
            }
        }
    } else {
        let scope_flag = if is_under_program_files(&app_dir) {
            "/ALLUSERS"
        } else {
            "/CURRENTUSER"
        };

        // Intento 1: NSIS silencioso exacto (/S /ALLUSERS|/CURRENTUSER /D=C:\ruta sin comillas)
        let silent_args = build_nsis_install_args("/S", scope_flag, &cfg.app_dir);
        append_updater_log(&log_path, &format!("Intento 1 NSIS silencioso: {silent_args}"));
        match Command::new(&payload_path).raw_arg(&silent_args).status() {
            Ok(status) => append_updater_log(
                &log_path,
                &format!("Intento 1 NSIS finalizó con estado: {status}"),
            ),
            Err(err) => append_updater_log(&log_path, &format!("Error Intento 1 NSIS: {err}")),
        }
        std::thread::sleep(Duration::from_millis(900));

        let mut updated_exe = find_updated_installed_exe(
            &current_exe,
            &app_dir,
            old_hash.as_deref(),
            install_started_at,
        );

        // Intento 2: NSIS en modo pasivo automático (/P) si /S no reemplazó el binario
        if updated_exe.is_none() {
            let passive_args = build_nsis_install_args("/P", scope_flag, &cfg.app_dir);
            append_updater_log(&log_path, &format!("Intento 2 NSIS pasivo: {passive_args}"));
            match Command::new(&payload_path).raw_arg(&passive_args).status() {
                Ok(status) => append_updater_log(
                    &log_path,
                    &format!("Intento 2 NSIS finalizó con estado: {status}"),
                ),
                Err(err) => append_updater_log(&log_path, &format!("Error Intento 2 NSIS: {err}")),
            }
            std::thread::sleep(Duration::from_millis(900));
            updated_exe = find_updated_installed_exe(
                &current_exe,
                &app_dir,
                old_hash.as_deref(),
                install_started_at,
            );
        }

        // Intento 3 (Red de seguridad infalible): si NSIS no actualizó el binario,
        // descargamos el .zip oficial del mismo Release (verificado por SHA-256) y reemplazamos en caliente.
        if updated_exe.is_none() {
            if let (Some(ref zip_url), Some(ref zip_name)) =
                (&cfg.portable_fallback_url, &cfg.portable_fallback_name)
            {
                append_updater_log(
                    &log_path,
                    &format!("Intento 3 respaldo directo ZIP oficial: {zip_name}"),
                );
                if let Ok(client) = build_http_client(300) {
                    let fallback_zip_path = staging_dir.join(zip_name);
                    match download_verified_file(
                        &client,
                        zip_url,
                        zip_name,
                        &fallback_zip_path,
                        cfg.checksums_url.as_deref(),
                        None,
                    ) {
                        Ok(_) => {
                            let extract_dir = staging_dir.join("fallback_extracted");
                            match extract_exe_from_portable_zip(&fallback_zip_path, &extract_dir) {
                                Ok((new_exe, _)) => {
                                    if replace_executable_atomically(&new_exe, &current_exe) {
                                        append_updater_log(
                                            &log_path,
                                            "Respaldo directo ZIP reemplazó el ejecutable correctamente.",
                                        );
                                        updated_exe = Some(current_exe.clone());
                                    }
                                }
                                Err(err) => append_updater_log(
                                    &log_path,
                                    &format!("Error extrayendo respaldo ZIP: {err}"),
                                ),
                            }
                        }
                        Err(err) => append_updater_log(
                            &log_path,
                            &format!("Error descargando respaldo ZIP: {err}"),
                        ),
                    }
                }
            }
        }

        if let Some(found_new) = updated_exe {
            append_updater_log(
                &log_path,
                &format!("Binario actualizado confirmado en: {}", found_new.display()),
            );
            // Si NSIS actualizó en otra ruta distinta al acceso directo original, sincronizar también current_exe
            let same_path = found_new
                .to_string_lossy()
                .eq_ignore_ascii_case(&current_exe.to_string_lossy());
            if !same_path && current_exe.exists() {
                let synced = replace_executable_atomically(&found_new, &current_exe);
                append_updater_log(
                    &log_path,
                    &format!(
                        "Sincronización hacia acceso directo original ({}): {synced}",
                        current_exe.display()
                    ),
                );
                launch_exe = if synced { current_exe.clone() } else { found_new };
            } else {
                launch_exe = found_new;
            }
        } else {
            append_updater_log(
                &log_path,
                "AVISO: No se confirmó cambio de binario; relanzando ejecutable existente.",
            );
        }
    }

    // Asegurar ruta existente antes de relanzar
    if !launch_exe.exists() {
        for cand in [
            app_dir.join("diskvault-clean.exe"),
            app_dir.join("DiskVault Clean.exe"),
        ] {
            if cand.exists() {
                launch_exe = cand;
                break;
            }
        }
    }

    std::thread::sleep(Duration::from_millis(400));
    if launch_exe.exists() {
        relaunch_updated_executable(&launch_exe, &log_path);
    } else {
        append_updater_log(
            &log_path,
            "ERROR: No se encontró ejecutable válido para relanzar.",
        );
    }

    // Limpiar archivos pesados del staging (la carpeta completa se borra al iniciar la nueva ventana)
    let _ = fs::remove_file(&payload_path);
    let _ = fs::remove_file(config_path);
}

#[cfg(not(windows))]
pub fn run_native_updater_helper(_config_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::{
        build_nsis_install_args, extract_expected_sha256, is_newer_version, is_under_program_files,
        parse_semver, validate_update_url,
    };
    use std::path::Path;

    #[test]
    fn compara_versiones_semanticas_correctamente() {
        assert_eq!(parse_semver("v1.1.0"), Some((1, 1, 0)));
        assert_eq!(parse_semver("1.2.10"), Some((1, 2, 10)));
        assert!(is_newer_version("1.0.0", "1.1.0"));
        assert!(is_newer_version("1.1.0", "v1.1.1"));
        assert!(is_newer_version("1.1.0", "2.0.0"));
        assert!(!is_newer_version("1.1.0", "1.1.0"));
        assert!(!is_newer_version("1.2.0", "1.1.9"));
    }

    #[test]
    fn valida_hosts_https_permitidos_de_github() {
        assert!(validate_update_url(
            "https://github.com/matkdark-cmyk/LIMPIADOR-DE-PC/releases/download/v1.1.0/DiskVaultClean_v1.1.0_Setup_x64.exe"
        )
        .is_ok());
        assert!(validate_update_url(
            "https://objects.githubusercontent.com/github-production-release-asset-123/file.exe"
        )
        .is_ok());
        assert!(validate_update_url("http://github.com/insecure.exe").is_err());
        assert!(validate_update_url("https://evil-domain.example/malware.exe").is_err());
        assert!(validate_update_url("https://127.0.0.1/local.exe").is_err());
    }

    #[test]
    fn extrae_sha256_desde_checksums_txt() {
        let sample = "\u{feff}0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  DiskVaultClean_v1.1.0_Setup_x64.exe\r\nfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210  DiskVaultClean_v1.1.0_Portable_x64.zip\r\n";
        assert_eq!(
            extract_expected_sha256(sample, "DiskVaultClean_v1.1.0_Setup_x64.exe"),
            Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string())
        );
        assert_eq!(extract_expected_sha256(sample, "otro.exe"), None);
    }

    #[test]
    fn construye_argumentos_nsis_exactos_con_ruta_al_final_sin_comillas() {
        assert_eq!(
            build_nsis_install_args("/S", "/ALLUSERS", r"C:\Program Files\DiskVault Clean\"),
            r"/S /ALLUSERS /D=C:\Program Files\DiskVault Clean"
        );
        assert_eq!(
            build_nsis_install_args(
                "/P",
                "/CURRENTUSER",
                r"C:\Users\Demo\AppData\Local\DiskVault Clean"
            ),
            r"/P /CURRENTUSER /D=C:\Users\Demo\AppData\Local\DiskVault Clean"
        );
        assert!(is_under_program_files(Path::new(
            r"C:\Program Files\DiskVault Clean"
        )));
        assert!(!is_under_program_files(Path::new(
            r"C:\Users\Demo\AppData\Local\DiskVault Clean"
        )));
    }
}
