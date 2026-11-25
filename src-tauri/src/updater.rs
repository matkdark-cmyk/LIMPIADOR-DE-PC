use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use url::Url;

/// Repositorio oficial de GitHub Releases para DiskVault Clean.
pub const GITHUB_REPO_OWNER: &str = "matkdark-cmyk";
pub const GITHUB_REPO_NAME: &str = "LIMPIADOR-DE-PC";

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
        // Respaldo: listar releases publicados por si ninguno está marcado como "latest"
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
        });
    };

    let latest_version = release
        .tag_name
        .trim()
        .trim_start_matches(['v', 'V'])
        .to_string();

    // Elegir el artefacto adecuado según el modo activo (Portable .zip o Instalador NSIS .exe)
    let matched_asset = if is_portable {
        release.assets.iter().find(|a| {
            let lower = a.name.to_ascii_lowercase();
            lower.ends_with(".zip") && lower.contains("portable")
        })
    } else {
        release.assets.iter().find(|a| {
            let lower = a.name.to_ascii_lowercase();
            lower.ends_with(".exe") && (lower.contains("setup") || lower.contains("diskvault"))
        })
    };

    let checksums_asset = release
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"));

    let update_available =
        is_newer_version(&current_version, &latest_version) && matched_asset.is_some();

    let notes = release
        .body
        .unwrap_or_default()
        .trim()
        .to_string();

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

/// Elimina archivos temporales `.old` dejados por una sustitución en caliente del ejecutable.
pub fn cleanup_old_update_artifacts() {
    if let Ok(exe_path) = std::env::current_exe() {
        let mut old_os = exe_path.as_os_str().to_os_string();
        old_os.push(".old");
        let old_path = std::path::PathBuf::from(old_os);
        if old_path.exists() {
            let _ = fs::remove_file(&old_path);
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

/// Descarga el paquete confirmado, verifica su SHA-256 si `SHA256SUMS.txt` está presente,
/// lanza el actualizador desacoplado en Windows y cierra la instancia actual para reiniciarse.
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

    let client = build_http_client(300)?;

    // 1. Descargar paquete en carpeta temporal aislada
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

    let mut response = client
        .get(&req.download_url)
        .send()
        .map_err(|err| format!("Error al descargar la actualización: {err}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "No se pudo descargar el paquete (HTTP {}).",
            response.status().as_u16()
        ));
    }

    // Verificar destino final tras posibles redirecciones de GitHub
    validate_update_url(response.url().as_str())?;

    let total_bytes = response.content_length().unwrap_or(0);
    let mut out_file = File::create(&payload_path)
        .map_err(|err| format!("No se pudo crear el archivo temporal de descarga: {err}"))?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

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

        if last_emit.elapsed() >= Duration::from_millis(120) {
            emit_update_progress(
                app_handle,
                "downloading",
                downloaded,
                total_bytes,
                &format!("Descargando {}...", safe_filename),
            );
            last_emit = Instant::now();
        }
    }

    out_file
        .flush()
        .map_err(|err| format!("No se pudo completar la escritura del paquete: {err}"))?;
    drop(out_file);

    emit_update_progress(
        app_handle,
        "verifying",
        downloaded,
        total_bytes.max(downloaded),
        "Verificando integridad SHA-256 del paquete descargado...",
    );

    // 2. Verificar hash SHA-256 si el Release publicó SHA256SUMS.txt
    let actual_hash = format!("{:x}", hasher.finalize());
    if let Some(ref cs_url) = req.checksums_url {
        if let Ok(cs_resp) = client.get(cs_url).send() {
            if cs_resp.status().is_success() {
                if let Ok(cs_text) = cs_resp.text() {
                    if let Some(expected_hash) = extract_expected_sha256(&cs_text, &safe_filename) {
                        if expected_hash != actual_hash {
                            let _ = fs::remove_dir_all(&staging_dir);
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

    emit_update_progress(
        app_handle,
        "installing",
        downloaded,
        total_bytes.max(downloaded),
        "Instalando actualización y reiniciando DiskVault Clean...",
    );

    // 3. Lanzar asistente desacoplado de actualización + reinicio automático en Windows
    launch_windows_self_updater(
        &payload_path,
        &staging_dir,
        is_portable,
        &req.version,
        logs_dir,
    )?;

    // 4. Breve pausa para asegurar que la UI reciba el evento y el asistente arranque antes de cerrar
    std::thread::sleep(Duration::from_millis(350));
    app_handle.exit(0);
    Ok(())
}

#[cfg(windows)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateHelperConfig {
    old_pid: u32,
    payload_path: String,
    staging_dir: String,
    current_exe: String,
    app_dir: String,
    is_portable: bool,
    target_version: String,
    log_path: String,
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
fn spawn_elevated_updater_powershell(script_path: &Path, config_path: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, ERROR_CANCELLED, HWND};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let params = format!(
        "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"{}\" -ConfigPath \"{}\"",
        script_path.display(),
        config_path.display()
    );

    let to_wide = |value: &OsStr| -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    };

    let verb_wide = to_wide(OsStr::new("runas"));
    let exe_wide = to_wide(OsStr::new("powershell.exe"));
    let params_wide = to_wide(OsStr::new(&params));

    let result = unsafe {
        ShellExecuteW(
            HWND::default(),
            PCWSTR(verb_wide.as_ptr()),
            PCWSTR(exe_wide.as_ptr()),
            PCWSTR(params_wide.as_ptr()),
            PCWSTR::null(),
            SW_HIDE,
        )
    };

    let code = result.0 as isize;
    if code > 32 {
        return Ok(());
    }

    let last_error = unsafe { GetLastError() };
    if last_error == ERROR_CANCELLED || code == 5 {
        return Err(
            "Se canceló el permiso de Administrador (UAC) necesario para actualizar la carpeta de instalación. No se cerró la aplicación."
                .to_string(),
        );
    }

    Err(format!(
        "No se pudo iniciar el asistente elevado de actualización (código {}, detalle {}).",
        code, last_error.0
    ))
}

#[cfg(windows)]
fn launch_windows_self_updater(
    payload_path: &Path,
    staging_dir: &Path,
    is_portable: bool,
    target_version: &str,
    logs_dir: &Path,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    // IMPORTANTE: En Win32 NO se deben combinar CREATE_NO_WINDOW y DETACHED_PROCESS.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    let current_exe = std::env::current_exe().map_err(|err| {
        format!("No se pudo determinar la ruta del ejecutable actual para reiniciar: {err}")
    })?;
    let app_dir = current_exe
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta del ejecutable actual.".to_string())?;

    let _ = fs::create_dir_all(logs_dir);
    let log_path = logs_dir.join("updater.log");

    // Guardar todos los parámetros en JSON UTF-8 para sobrevivir incluso cruces UAC ("runas")
    let config_path = staging_dir.join("update_config.json");
    let config = UpdateHelperConfig {
        old_pid: std::process::id(),
        payload_path: payload_path.to_string_lossy().to_string(),
        staging_dir: staging_dir.to_string_lossy().to_string(),
        current_exe: current_exe.to_string_lossy().to_string(),
        app_dir: app_dir.to_string_lossy().to_string(),
        is_portable,
        target_version: target_version.trim().trim_start_matches(['v', 'V']).to_string(),
        log_path: log_path.to_string_lossy().to_string(),
    };
    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|err| format!("No se pudo serializar la configuración de actualización: {err}"))?;
    fs::write(&config_path, config_json.as_bytes())
        .map_err(|err| format!("No se pudo guardar la configuración de actualización: {err}"))?;

    // Script PowerShell puro ASCII guardado con BOM UTF-8 para máxima compatibilidad con PowerShell 5.1
    let script_path = staging_dir.join("apply_update.ps1");
    let ps_script = r#"param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
)

$ErrorActionPreference = 'Continue'

$cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$oldPid = [int]$cfg.oldPid
$payload = [string]$cfg.payloadPath
$stagingDir = [string]$cfg.stagingDir
$currentExe = [string]$cfg.currentExe
$appDir = [string]$cfg.appDir
$appDirClean = $appDir.TrimEnd('\', '/')
$isPortable = [bool]$cfg.isPortable
$targetVer = [string]$cfg.targetVersion
$logPath = [string]$cfg.logPath

function Write-Log {
    param([string]$Message)
    try {
        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $logPath -Value "[$ts] $Message" -Encoding UTF8
    } catch {}
}

function Get-SafeHash {
    param([string]$Path)
    try {
        if (Test-Path -LiteralPath $Path) {
            return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } catch {}
    return ''
}

function Get-ExeVersion {
    param([string]$Path)
    try {
        if (Test-Path -LiteralPath $Path) {
            $vi = (Get-Item -LiteralPath $Path).VersionInfo
            if ($vi -and $vi.ProductVersion) { return ([string]$vi.ProductVersion).Trim() }
            if ($vi -and $vi.FileVersion) { return ([string]$vi.FileVersion).Trim() }
        }
    } catch {}
    return ''
}

function Test-ExeMatchesTarget {
    param([string]$ExePath, [string]$OldHash)
    if (-not (Test-Path -LiteralPath $ExePath)) { return $false }
    $ver = Get-ExeVersion -Path $ExePath
    if ($targetVer -and $ver -and $ver.StartsWith($targetVer)) {
        return $true
    }
    $newHash = Get-SafeHash -Path $ExePath
    if ($OldHash -and $newHash -and ($newHash -ne $OldHash)) {
        return $true
    }
    return $false
}

function Replace-ExeFile {
    param([string]$SourceExe, [string]$DestExe)
    $srcHash = Get-SafeHash -Path $SourceExe
    for ($attempt = 1; $attempt -le 15; $attempt++) {
        try {
            Copy-Item -LiteralPath $SourceExe -Destination $DestExe -Force -ErrorAction Stop
            $dstHash = Get-SafeHash -Path $DestExe
            if (-not $srcHash -or $dstHash -eq $srcHash) {
                return $true
            }
        } catch {
            try {
                $oldBackup = "$DestExe.old"
                if (Test-Path -LiteralPath $oldBackup) {
                    Remove-Item -LiteralPath $oldBackup -Force -ErrorAction SilentlyContinue
                }
                if (Test-Path -LiteralPath $DestExe) {
                    Move-Item -LiteralPath $DestExe -Destination $oldBackup -Force -ErrorAction Stop
                }
                Copy-Item -LiteralPath $SourceExe -Destination $DestExe -Force -ErrorAction Stop
                return $true
            } catch {
                Start-Sleep -Milliseconds 400
            }
        }
    }
    return $false
}

function Find-UpdatedExecutable {
    param([string]$OldHash)
    if (Test-ExeMatchesTarget -ExePath $currentExe -OldHash $OldHash) {
        return $currentExe
    }

    $dirs = @(
        $appDirClean,
        (Join-Path $env:LOCALAPPDATA 'DiskVault Clean'),
        (Join-Path $env:LOCALAPPDATA 'Programs\DiskVault Clean'),
        (Join-Path $env:ProgramFiles 'DiskVault Clean')
    )
    if (${env:ProgramFiles(x86)}) {
        $dirs += (Join-Path ${env:ProgramFiles(x86)} 'DiskVault Clean')
    }

    $exeNames = @(
        (Split-Path -Leaf $currentExe),
        'diskvault-clean.exe',
        'DiskVault Clean.exe',
        'DiskVaultClean.exe'
    )

    foreach ($d in ($dirs | Select-Object -Unique)) {
        if (-not $d -or -not (Test-Path -LiteralPath $d)) { continue }
        foreach ($n in ($exeNames | Select-Object -Unique)) {
            $cand = Join-Path $d $n
            if (Test-Path -LiteralPath $cand) {
                $ver = Get-ExeVersion -Path $cand
                if ($targetVer -and $ver -and $ver.StartsWith($targetVer)) {
                    return $cand
                }
            }
        }
    }

    foreach ($d in ($dirs | Select-Object -Unique)) {
        if (-not $d -or -not (Test-Path -LiteralPath $d)) { continue }
        foreach ($n in ($exeNames | Select-Object -Unique)) {
            $cand = Join-Path $d $n
            if (Test-ExeMatchesTarget -ExePath $cand -OldHash $OldHash) {
                return $cand
            }
        }
    }

    return $null
}

Write-Log "=== Starting DiskVault Clean auto-update to v$targetVer (portable=$isPortable) ==="
Write-Log "CurrentExe: $currentExe | Payload: $payload"

$oldHash = Get-SafeHash -Path $currentExe
Write-Log "OldExeHash: $oldHash"

# 1. Esperar a que termine la instancia anterior y liberar bloqueos de archivo
for ($w = 0; $w -lt 24; $w++) {
    $p = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if (-not $p) { break }
    Start-Sleep -Milliseconds 250
}
$stillRunning = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
if ($stillRunning) {
    Write-Log "Force stopping old PID $oldPid"
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
}

# Cerrar cualquier otra instancia que este ejecutando exactamente el mismo binario
try {
    $normCurrent = $currentExe.ToLowerInvariant()
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Id -ne $PID -and $_.Path -and $_.Path.ToLowerInvariant() -eq $normCurrent
    } | ForEach-Object {
        Write-Log "Stopping sibling process PID $($_.Id)"
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
} catch {}

Start-Sleep -Milliseconds 900

$launchExe = $currentExe

if ($isPortable) {
    $extractDir = Join-Path $stagingDir 'extracted'
    if (Test-Path -LiteralPath $extractDir) {
        Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Expand-Archive -LiteralPath $payload -DestinationPath $extractDir -Force

    $newExe = Get-ChildItem -Path $extractDir -Filter '*.exe' -File -Recurse |
        Sort-Object Length -Descending |
        Select-Object -First 1

    if ($newExe) {
        $ok = Replace-ExeFile -SourceExe $newExe.FullName -DestExe $currentExe
        Write-Log "Portable binary replace result: $ok"
    }

    $readmeSrc = Join-Path $extractDir 'LEEME_PORTABLE.txt'
    if (Test-Path -LiteralPath $readmeSrc) {
        Copy-Item -LiteralPath $readmeSrc -Destination (Join-Path $appDirClean 'LEEME_PORTABLE.txt') -Force -ErrorAction SilentlyContinue
    }
} else {
    $pf1 = if ($env:ProgramFiles) { $env:ProgramFiles.TrimEnd('\').ToLowerInvariant() } else { '' }
    $pf2 = if (${env:ProgramFiles(x86)}) { ${env:ProgramFiles(x86)}.TrimEnd('\').ToLowerInvariant() } else { '' }
    $appLower = $appDirClean.ToLowerInvariant()

    $isMachineInstall = ($pf1 -and $appLower.StartsWith($pf1)) -or ($pf2 -and $appLower.StartsWith($pf2))
    $scopeFlag = if ($isMachineInstall) { '/ALLUSERS' } else { '/CURRENTUSER' }

    # Intento 1: Instalacion silenciosa exacta en el mismo alcance y carpeta (/D= SIEMPRE al final y sin comillas)
    $silentArgs = "/S $scopeFlag /D=$appDirClean"
    Write-Log "Attempt 1 (NSIS silent): $silentArgs"
    try {
        $p1 = Start-Process -FilePath $payload -ArgumentList $silentArgs -Wait -PassThru
        Write-Log "Attempt 1 exit code: $($p1.ExitCode)"
    } catch {
        Write-Log "Attempt 1 exception: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 1000

    $updatedExe = Find-UpdatedExecutable -OldHash $oldHash

    # Intento 2: Modo pasivo automatico (/P) si el modo silencioso /S no actualizo el binario
    if (-not $updatedExe) {
        $passiveArgs = "/P $scopeFlag /D=$appDirClean"
        Write-Log "Attempt 2 (NSIS passive): $passiveArgs"
        try {
            $p2 = Start-Process -FilePath $payload -ArgumentList $passiveArgs -Wait -PassThru
            Write-Log "Attempt 2 exit code: $($p2.ExitCode)"
        } catch {
            Write-Log "Attempt 2 exception: $($_.Exception.Message)"
        }
        Start-Sleep -Milliseconds 1000
        $updatedExe = Find-UpdatedExecutable -OldHash $oldHash
    }

    # Intento 3: Respaldo interactivo si el sistema bloqueo ambos modos desatendidos
    if (-not $updatedExe) {
        $fallbackArgs = "$scopeFlag /D=$appDirClean"
        Write-Log "Attempt 3 (NSIS interactive fallback): $fallbackArgs"
        try {
            $p3 = Start-Process -FilePath $payload -ArgumentList $fallbackArgs -Wait -PassThru
            Write-Log "Attempt 3 exit code: $($p3.ExitCode)"
        } catch {
            Write-Log "Attempt 3 exception: $($_.Exception.Message)"
        }
        Start-Sleep -Milliseconds 1000
        $updatedExe = Find-UpdatedExecutable -OldHash $oldHash
    }

    if ($updatedExe) {
        Write-Log "Verified updated executable at: $updatedExe (version=$(Get-ExeVersion -Path $updatedExe))"
        if ($updatedExe.ToLowerInvariant() -ne $currentExe.ToLowerInvariant() -and (Test-Path -LiteralPath $currentExe)) {
            $synced = Replace-ExeFile -SourceExe $updatedExe -DestExe $currentExe
            Write-Log "Synced updated executable back to original path ($currentExe): $synced"
            if ($synced -and (Test-ExeMatchesTarget -ExePath $currentExe -OldHash $oldHash)) {
                $launchExe = $currentExe
            } else {
                $launchExe = $updatedExe
            }
        } else {
            $launchExe = $updatedExe
        }
    } else {
        Write-Log "WARNING: Updated binary not confirmed; falling back to existing executable."
    }
}

# 2. Garantizar que exista un ejecutable valido para relanzar
if (-not (Test-Path -LiteralPath $launchExe)) {
    $fallbackCandidates = @(
        (Join-Path $appDirClean 'diskvault-clean.exe'),
        (Join-Path $appDirClean 'DiskVault Clean.exe'),
        (Join-Path $env:LOCALAPPDATA 'DiskVault Clean\diskvault-clean.exe'),
        (Join-Path $env:LOCALAPPDATA 'DiskVault Clean\DiskVault Clean.exe'),
        (Join-Path $env:ProgramFiles 'DiskVault Clean\diskvault-clean.exe'),
        (Join-Path $env:ProgramFiles 'DiskVault Clean\DiskVault Clean.exe')
    )
    foreach ($cand in $fallbackCandidates) {
        if (Test-Path -LiteralPath $cand) {
            $launchExe = $cand
            break
        }
    }
}

Start-Sleep -Milliseconds 500
if (Test-Path -LiteralPath $launchExe) {
    $workDir = Split-Path -Parent $launchExe
    Write-Log "Relaunching updated app: $launchExe"
    try {
        $null = Start-Process -FilePath $launchExe -WorkingDirectory $workDir -PassThru
    } catch {
        Write-Log "Direct relaunch failed: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds 2
    $procName = [System.IO.Path]::GetFileNameWithoutExtension($launchExe)
    $alive = Get-Process -Name $procName -ErrorAction SilentlyContinue
    if (-not $alive) {
        Write-Log "Process not detected after direct launch; retrying via explorer.exe"
        try {
            Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $launchExe + '"')
        } catch {
            Write-Log "Explorer relaunch failed: $($_.Exception.Message)"
        }
    } else {
        Write-Log "New instance confirmed running (count=$($alive.Count))."
    }
} else {
    Write-Log "ERROR: Could not locate executable to relaunch."
}

Start-Sleep -Seconds 3
Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
"#;

    let mut script_bytes = Vec::with_capacity(ps_script.len() + 3);
    script_bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]); // UTF-8 BOM para PowerShell 5.1
    script_bytes.extend_from_slice(ps_script.as_bytes());
    fs::write(&script_path, &script_bytes)
        .map_err(|err| format!("No se pudo preparar el asistente de actualización: {err}"))?;

    // Si la carpeta de instalación requiere permisos de Administrador y aún no estamos elevados,
    // pedimos UAC AHORA (con la ventana visible) antes de cerrar la app.
    let needs_elevation =
        !crate::uac::is_running_as_admin() && (!can_write_to_dir(app_dir) || is_under_program_files(app_dir));

    if needs_elevation {
        spawn_elevated_updater_powershell(&script_path, &config_path)?;
        return Ok(());
    }

    Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script_path)
        .arg("-ConfigPath")
        .arg(&config_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|err| format!("No se pudo iniciar el proceso de actualización automática: {err}"))?;

    Ok(())
}

#[cfg(not(windows))]
fn launch_windows_self_updater(
    _payload_path: &Path,
    _staging_dir: &Path,
    _is_portable: bool,
    _target_version: &str,
    _logs_dir: &Path,
) -> Result<(), String> {
    Err("La instalación automática con reinicio solo está disponible en Windows.".to_string())
}

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
            build_nsis_install_args("/P", "/CURRENTUSER", r"C:\Users\Demo\AppData\Local\DiskVault Clean"),
            r"/P /CURRENTUSER /D=C:\Users\Demo\AppData\Local\DiskVault Clean"
        );
        assert!(is_under_program_files(Path::new(r"C:\Program Files\DiskVault Clean")));
        assert!(!is_under_program_files(Path::new(r"C:\Users\Demo\AppData\Local\DiskVault Clean")));
    }
}
