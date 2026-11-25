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

/// Descarga el paquete confirmado, verifica su SHA-256 si `SHA256SUMS.txt` está presente,
/// lanza el actualizador desacoplado en Windows y cierra la instancia actual para reiniciarse.
pub fn download_and_apply_update(
    app_handle: &AppHandle,
    req: &InstallUpdateRequest,
    is_portable: bool,
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
    launch_windows_self_updater(&payload_path, &staging_dir, is_portable)?;

    // 4. Cerrar limpiamente la instancia actual para que el actualizador reemplace y abra la ventana nueva
    app_handle.exit(0);
    Ok(())
}

#[cfg(windows)]
fn launch_windows_self_updater(
    payload_path: &Path,
    staging_dir: &Path,
    is_portable: bool,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    let current_exe = std::env::current_exe().map_err(|err| {
        format!("No se pudo determinar la ruta del ejecutable actual para reiniciar: {err}")
    })?;
    let app_dir = current_exe
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta del ejecutable actual.".to_string())?;

    // Script PowerShell limpio que lee todos los parámetros desde variables de entorno
    // (inmune a inyección por comillas o caracteres especiales en rutas).
    let script_path = staging_dir.join("apply_update.ps1");
    let ps_script = r#"
$ErrorActionPreference = 'Continue'
$oldPid = [int]$env:DV_OLD_PID
$payload = $env:DV_PAYLOAD_PATH
$stagingDir = $env:DV_STAGING_DIR
$currentExe = $env:DV_CURRENT_EXE
$appDir = $env:DV_APP_DIR
$isPortable = ($env:DV_IS_PORTABLE -eq '1')

try {
    $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if ($proc) {
        $null = $proc.WaitForExit(30000)
    }
} catch {}
Start-Sleep -Milliseconds 600

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
        for ($i = 0; $i -lt 10; $i++) {
            try {
                Copy-Item -LiteralPath $newExe.FullName -Destination $currentExe -Force -ErrorAction Stop
                break
            } catch {
                Start-Sleep -Milliseconds 400
            }
        }
    }

    $readmeSrc = Join-Path $extractDir 'LEEME_PORTABLE.txt'
    if (Test-Path -LiteralPath $readmeSrc) {
        Copy-Item -LiteralPath $readmeSrc -Destination (Join-Path $appDir 'LEEME_PORTABLE.txt') -Force -ErrorAction SilentlyContinue
    }
} else {
    $installProc = Start-Process -FilePath $payload -ArgumentList '/S' -PassThru -Wait
    if ($installProc -and $installProc.ExitCode -ne 0) {
        # Respaldo interactivo si el instalador requiere elevación UAC para instalación global
        Start-Process -FilePath $payload -Wait
    }

    if (-not (Test-Path -LiteralPath $launchExe)) {
        $candidates = @(
            (Join-Path $env:LOCALAPPDATA 'DiskVault Clean\DiskVault Clean.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\DiskVault Clean\DiskVault Clean.exe'),
            (Join-Path $env:ProgramFiles 'DiskVault Clean\DiskVault Clean.exe')
        )
        foreach ($cand in $candidates) {
            if (Test-Path -LiteralPath $cand) {
                $launchExe = $cand
                break
            }
        }
    }
}

Start-Sleep -Milliseconds 400
if (Test-Path -LiteralPath $launchExe) {
    $workDir = Split-Path -Parent $launchExe
    Start-Process -FilePath $launchExe -WorkingDirectory $workDir
}

Start-Sleep -Seconds 2
Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
"#;

    fs::write(&script_path, ps_script.as_bytes())
        .map_err(|err| format!("No se pudo preparar el asistente de actualización: {err}"))?;

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
        .env("DV_OLD_PID", std::process::id().to_string())
        .env("DV_PAYLOAD_PATH", payload_path)
        .env("DV_STAGING_DIR", staging_dir)
        .env("DV_CURRENT_EXE", &current_exe)
        .env("DV_APP_DIR", app_dir)
        .env("DV_IS_PORTABLE", if is_portable { "1" } else { "0" })
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .map_err(|err| format!("No se pudo iniciar el proceso de actualización automática: {err}"))?;

    Ok(())
}

#[cfg(not(windows))]
fn launch_windows_self_updater(
    _payload_path: &Path,
    _staging_dir: &Path,
    _is_portable: bool,
) -> Result<(), String> {
    Err("La instalación automática con reinicio solo está disponible en Windows.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{extract_expected_sha256, is_newer_version, parse_semver, validate_update_url};

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
}
