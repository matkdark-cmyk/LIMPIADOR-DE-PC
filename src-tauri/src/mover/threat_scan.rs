use jwalk::WalkDir;
use serde::Serialize;
use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Firma estándar de prueba antivirus EICAR dividida en dos mitades para evitar que
/// el propio binario compilado de DiskVault Clean dispare falsos positivos en antivirus.
const EICAR_PREFIX: &[u8] = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}";
const EICAR_SUFFIX: &[u8] = b"$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/// Comprueba en memoria si un búfer contiene la firma estándar de prueba antivirus EICAR.
pub fn contains_eicar_signature(bytes: &[u8]) -> bool {
    let total_len = EICAR_PREFIX.len() + EICAR_SUFFIX.len();
    if bytes.len() < total_len {
        return false;
    }
    bytes.windows(total_len).any(|window| {
        &window[..EICAR_PREFIX.len()] == EICAR_PREFIX
            && &window[EICAR_PREFIX.len()..] == EICAR_SUFFIX
    })
}

/// Nivel de severidad de un archivo detectado antes de transferir datos a otro disco o al NAS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreatSeverity {
    /// Virus, malware confirmado por Windows Defender, firma EICAR, RTLO o ejecutable camuflado.
    Malware,
    /// Archivo sospechoso (doble extensión engañosa, script ofuscado/descargador o extensión de alto riesgo).
    Suspicious,
}

/// Hallazgo individual con ruta exacta y motivo claro en español para que el usuario pueda verificarlo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreatFinding {
    pub file_path: String,
    pub file_name: String,
    pub severity: ThreatSeverity,
    pub engine: String,
    pub threat_name: String,
    pub reason: String,
}

/// Reporte completo del análisis de seguridad previo a la transferencia.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreatScanReport {
    pub source_path: String,
    pub files_scanned: u64,
    pub defender_used: bool,
    pub defender_note: Option<String>,
    pub findings: Vec<ThreatFinding>,
    pub has_threats: bool,
    pub duration_ms: u64,
}

/// Extensiones benignas comúnmente suplantadas en ataques de doble extensión (ej. `factura.pdf.exe`).
const BENIGN_DECOY_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "jpg", "jpeg",
    "png", "gif", "bmp", "webp", "mp3", "wav", "mp4", "mkv", "avi", "mov", "zip", "rar", "7z",
];

/// Extensiones ejecutables o de script peligrosas cuando aparecen como segunda extensión.
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "exe", "scr", "pif", "bat", "cmd", "com", "vbs", "vbe", "js", "jse", "wsf", "wsh", "ps1",
    "hta", "msi", "cpl", "lnk", "reg",
];

/// Extensiones de alto riesgo directo poco comunes en respaldos personales.
const HIGH_RISK_STANDALONE_EXTENSIONS: &[&str] = &["scr", "pif", "hta", "vbe", "jse", "wsf", "wsh"];

/// Extensiones que jamás deberían contener un binario ejecutable Windows PE (`MZ` + `PE\0\0`).
const NON_EXECUTABLE_DOCUMENT_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "json", "xml", "jpg",
    "jpeg", "png", "gif", "bmp", "webp", "svg", "mp3", "wav", "flac", "mp4", "mkv", "avi", "mov",
];

/// Extensiones de scripts inspeccionables en busca de patrones ofuscados o descargadores maliciosos.
const INSPECTABLE_SCRIPT_EXTENSIONS: &[&str] =
    &["ps1", "bat", "cmd", "vbs", "vbe", "js", "jse", "hta", "wsf"];

/// Patrones de alto riesgo en scripts descargadores/ofuscados.
const SUSPICIOUS_SCRIPT_PATTERNS: &[(&str, &str)] = &[
    ("-encodedcommand", "Comando PowerShell codificado en Base64 (-EncodedCommand)"),
    (" -enc ", "Comando PowerShell codificado en Base64 (-enc)"),
    ("invoke-expression", "Ejecución dinámica de código remoto (Invoke-Expression)"),
    ("downloadstring(", "Descarga remota en memoria desde script (DownloadString)"),
    ("downloadfile(", "Descarga automática de archivos desde script (DownloadFile)"),
    ("frombase64string(", "Decodificación Base64 sospechosa dentro de un script"),
    ("wscript.shell", "Invocación directa del intérprete del sistema (WScript.Shell)"),
    ("windowstyle hidden", "Ejecución oculta de PowerShell sin ventana visible"),
    ("-w hidden", "Ejecución oculta de PowerShell sin ventana visible"),
    ("add-mppreference", "Intento de desactivar exclusiones de Windows Defender"),
    ("certutil -urlcache", "Uso de certutil para descargar ejecutables desde internet"),
    ("bitsadmin /transfer", "Descarga en segundo plano mediante bitsadmin"),
    ("mshta http", "Ejecución remota de aplicación HTML (mshta)"),
];

/// Detecta si los primeros bytes de un archivo corresponden a un ejecutable Windows PE válido (`MZ` + `PE\0\0`).
fn looks_like_windows_pe(bytes: &[u8]) -> bool {
    if bytes.len() < 64 || &bytes[0..2] != b"MZ" {
        return false;
    }
    let pe_offset = u32::from_le_bytes([bytes[60], bytes[61], bytes[62], bytes[63]]) as usize;
    if pe_offset + 4 <= bytes.len() {
        &bytes[pe_offset..pe_offset + 4] == b"PE\0\0"
    } else {
        false
    }
}

/// Analiza un archivo individual con reglas heurísticas locales (rápido: lee máx. 64 KiB).
pub fn inspect_file_heuristics(path: &Path) -> Option<ThreatFinding> {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let file_path = path.to_string_lossy().to_string();

    // Regla 1: Carácter Unicode Right-to-Left Override (U+202E) usado para falsificar extensiones
    if file_name.contains('\u{202E}') {
        return Some(ThreatFinding {
            file_path,
            file_name,
            severity: ThreatSeverity::Malware,
            engine: "Análisis Heurístico".to_string(),
            threat_name: "Suplantación Unicode RTLO".to_string(),
            reason: "El nombre del archivo contiene el carácter oculto U+202E (RTLO), una técnica frecuente de malware para disfrazar un ejecutable como documento o imagen.".to_string(),
        });
    }

    let lower_name = file_name.to_ascii_lowercase();
    let dot_parts: Vec<&str> = lower_name.split('.').collect();
    let last_ext = dot_parts.last().copied().unwrap_or("");

    // Regla 2: Doble extensión engañosa (ej. factura.pdf.exe, foto.jpg.scr, recibo.docx.vbs)
    if dot_parts.len() >= 3 {
        let prev_ext = dot_parts[dot_parts.len() - 2];
        if BENIGN_DECOY_EXTENSIONS.contains(&prev_ext) && EXECUTABLE_EXTENSIONS.contains(&last_ext)
        {
            return Some(ThreatFinding {
                file_path,
                file_name,
                severity: ThreatSeverity::Suspicious,
                engine: "Análisis Heurístico".to_string(),
                threat_name: format!("Doble extensión engañosa (.{prev_ext}.{last_ext})"),
                reason: format!(
                    "El archivo aparenta ser '.{prev_ext}' pero en realidad es un ejecutable o script '.{last_ext}'."
                ),
            });
        }
    }

    // Leer encabezado (máximo 64 KiB) para firmas de contenido sin ralentizar carpetas de gigas
    let mut header = Vec::new();
    if let Ok(mut file) = File::open(path) {
        let mut buf = [0u8; 65_536];
        if let Ok(n) = file.read(&mut buf) {
            header.extend_from_slice(&buf[..n]);
        }
    }

    // Regla 3: Firma estándar de prueba antivirus EICAR
    if contains_eicar_signature(&header) {
        return Some(ThreatFinding {
            file_path,
            file_name,
            severity: ThreatSeverity::Malware,
            engine: "Análisis Heurístico".to_string(),
            threat_name: "EICAR-Test-File".to_string(),
            reason: "Se detectó la firma estándar de prueba antivirus EICAR dentro del archivo."
                .to_string(),
        });
    }

    // Regla 4: Binario ejecutable PE (MZ) oculto bajo una extensión de documento o multimedia
    if NON_EXECUTABLE_DOCUMENT_EXTENSIONS.contains(&last_ext) && looks_like_windows_pe(&header) {
        return Some(ThreatFinding {
            file_path,
            file_name,
            severity: ThreatSeverity::Malware,
            engine: "Análisis Heurístico".to_string(),
            threat_name: "Ejecutable camuflado (PE/MZ)".to_string(),
            reason: format!(
                "El archivo tiene extensión '.{last_ext}' pero contiene un programa ejecutable de Windows (cabecera MZ/PE) en su interior."
            ),
        });
    }

    // Regla 5: Scripts con patrones de descarga remota, ofuscación o evasión de antivirus
    if INSPECTABLE_SCRIPT_EXTENSIONS.contains(&last_ext) && !header.is_empty() {
        let lower_text = String::from_utf8_lossy(&header).to_ascii_lowercase();
        for (pattern, explanation) in SUSPICIOUS_SCRIPT_PATTERNS {
            if lower_text.contains(pattern) {
                return Some(ThreatFinding {
                    file_path,
                    file_name,
                    severity: ThreatSeverity::Suspicious,
                    engine: "Análisis Heurístico".to_string(),
                    threat_name: format!("Script sospechoso (.{last_ext})"),
                    reason: format!("{explanation}."),
                });
            }
        }
    }

    // Regla 6: Extensiones ejecutables de alto riesgo poco habituales en respaldos de usuario
    if HIGH_RISK_STANDALONE_EXTENSIONS.contains(&last_ext) {
        return Some(ThreatFinding {
            file_path,
            file_name,
            severity: ThreatSeverity::Suspicious,
            engine: "Análisis Heurístico".to_string(),
            threat_name: format!("Archivo ejecutable de riesgo (.{last_ext})"),
            reason: format!(
                "Los archivos '.{last_ext}' pueden ejecutar código automáticamente al abrirse y suelen ser aprovechados por malware."
            ),
        });
    }

    None
}

/// Parsea la salida de `MpCmdRun.exe -Scan -ScanType 3 -File <ruta> -DisableRemediation`.
pub fn parse_defender_output(stdout: &str, fallback_source: &Path) -> Vec<ThreatFinding> {
    let mut findings = Vec::new();
    let mut current_threat: Option<String> = None;

    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        let lower = line.to_ascii_lowercase();

        if let Some(rest) = line.strip_prefix("Threat") {
            if let Some((_, val)) = rest.split_once(':') {
                let name = val.trim();
                if !name.is_empty() {
                    current_threat = Some(name.to_string());
                }
            }
        } else if lower.starts_with("file") || lower.starts_with("containerfile") {
            if let Some((_, raw_path)) = line.split_once(':') {
                let cleaned_path = raw_path
                    .trim()
                    .split("->")
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_matches('"');
                if !cleaned_path.is_empty() {
                    let p = Path::new(cleaned_path);
                    let fname = p
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| cleaned_path.to_string());
                    let threat = current_threat
                        .clone()
                        .unwrap_or_else(|| "Amenaza detectada por Windows Defender".to_string());
                    findings.push(ThreatFinding {
                        file_path: cleaned_path.to_string(),
                        file_name: fname,
                        severity: ThreatSeverity::Malware,
                        engine: "Windows Defender".to_string(),
                        threat_name: threat.clone(),
                        reason: format!(
                            "Windows Defender identificó una amenaza activa ({threat}) en esta ruta."
                        ),
                    });
                }
            }
        }
    }

    if findings.is_empty() {
        let fallback_str = fallback_source.to_string_lossy().to_string();
        let fallback_name = fallback_source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| fallback_str.clone());
        let threat = current_threat
            .unwrap_or_else(|| "Amenaza detectada por Windows Defender".to_string());
        findings.push(ThreatFinding {
            file_path: fallback_str,
            file_name: fallback_name,
            severity: ThreatSeverity::Malware,
            engine: "Windows Defender".to_string(),
            threat_name: threat.clone(),
            reason: format!(
                "Windows Defender detectó una amenaza ({threat}) dentro del origen seleccionado."
            ),
        });
    }

    findings
}

#[cfg(windows)]
fn locate_mpcmdrun() -> Option<PathBuf> {
    let platform_dir = Path::new(r"C:\ProgramData\Microsoft\Windows Defender\Platform");
    if platform_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(platform_dir) {
            let mut candidates: Vec<PathBuf> = entries
                .filter_map(|e| e.ok().map(|entry| entry.path().join("MpCmdRun.exe")))
                .filter(|p| p.is_file())
                .collect();
            candidates.sort();
            if let Some(latest) = candidates.pop() {
                return Some(latest);
            }
        }
    }

    let legacy = PathBuf::from(r"C:\Program Files\Windows Defender\MpCmdRun.exe");
    if legacy.is_file() {
        return Some(legacy);
    }

    None
}

#[cfg(windows)]
fn run_windows_defender_scan(source: &Path) -> (bool, Option<String>, Vec<ThreatFinding>) {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Some(mpcmdrun) = locate_mpcmdrun() else {
        return (
            false,
            Some("Windows Defender no está disponible en este equipo; se aplicó el análisis heurístico local.".to_string()),
            Vec::new(),
        );
    };

    let output = Command::new(&mpcmdrun)
        .arg("-Scan")
        .arg("-ScanType")
        .arg("3")
        .arg("-File")
        .arg(source)
        .arg("-DisableRemediation")
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match output {
        Ok(out) => {
            let code = out.status.code().unwrap_or(-1);
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            match code {
                0 => (true, None, Vec::new()),
                2 => {
                    let findings = parse_defender_output(&stdout, source);
                    (true, None, findings)
                }
                other => (
                    false,
                    Some(format!(
                        "Windows Defender no pudo completar el análisis directo (código {other}); se aplicó el análisis heurístico local."
                    )),
                    Vec::new(),
                ),
            }
        }
        Err(_) => (
            false,
            Some("No se pudo invocar Windows Defender; se aplicó el análisis heurístico local.".to_string()),
            Vec::new(),
        ),
    }
}

#[cfg(not(windows))]
fn run_windows_defender_scan(_source: &Path) -> (bool, Option<String>, Vec<ThreatFinding>) {
    (
        false,
        Some("Análisis con motor heurístico local activo.".to_string()),
        Vec::new(),
    )
}

/// Ejecuta el análisis completo de seguridad (Windows Defender + Heurístico local) sobre el origen
/// antes de transferir datos a otro disco o al NAS.
pub fn scan_source_for_threats(source_raw: &str) -> Result<ThreatScanReport, String> {
    let started = Instant::now();
    let trimmed = source_raw.trim();
    if trimmed.is_empty() {
        return Err("Debes seleccionar un archivo o carpeta de origen para analizar.".to_string());
    }

    let source = Path::new(trimmed);
    if !source.exists() {
        return Err(format!("La ruta de origen '{}' no existe.", source.display()));
    }

    // 1. Escaneo real con Windows Defender (solo lectura con -DisableRemediation)
    let (defender_used, defender_note, mut findings) = run_windows_defender_scan(source);

    let mut seen_paths: HashSet<String> = findings
        .iter()
        .map(|f| f.file_path.to_ascii_lowercase())
        .collect();

    // 2. Escaneo heurístico nativo archivo por archivo
    let mut files_scanned: u64 = 0;

    if source.is_file() {
        files_scanned = 1;
        if let Some(finding) = inspect_file_heuristics(source) {
            let key = finding.file_path.to_ascii_lowercase();
            if seen_paths.insert(key) {
                findings.push(finding);
            }
        }
    } else if source.is_dir() {
        for entry in WalkDir::new(source).follow_links(false).skip_hidden(false) {
            let Ok(item) = entry else {
                continue;
            };
            if !item.file_type().is_file() {
                continue;
            }
            files_scanned = files_scanned.saturating_add(1);
            if let Some(finding) = inspect_file_heuristics(&item.path()) {
                let key = finding.file_path.to_ascii_lowercase();
                if seen_paths.insert(key) {
                    findings.push(finding);
                }
            }
        }
    }

    // Ordenar mostrando primero Malware (amenazas graves) y luego archivos sospechosos
    findings.sort_by(|a, b| {
        let rank = |s: ThreatSeverity| match s {
            ThreatSeverity::Malware => 0,
            ThreatSeverity::Suspicious => 1,
        };
        rank(a.severity)
            .cmp(&rank(b.severity))
            .then_with(|| a.file_path.cmp(&b.file_path))
    });

    let has_threats = !findings.is_empty();

    Ok(ThreatScanReport {
        source_path: trimmed.to_string(),
        files_scanned,
        defender_used,
        defender_note,
        findings,
        has_threats,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        contains_eicar_signature, inspect_file_heuristics, parse_defender_output,
        scan_source_for_threats, ThreatSeverity, EICAR_PREFIX, EICAR_SUFFIX,
    };
    use std::fs;
    use std::path::Path;

    #[test]
    fn detecta_firma_eicar_en_memoria_sin_disparar_antivirus_en_ci() {
        let mut combined = Vec::new();
        combined.extend_from_slice(EICAR_PREFIX);
        combined.extend_from_slice(EICAR_SUFFIX);
        assert!(contains_eicar_signature(&combined));
        assert!(!contains_eicar_signature(b"archivo de texto completamente normal"));
    }

    #[test]
    fn detecta_doble_extension_ejecutable_camuflado_y_script_sospechoso() {
        let temp_dir = std::env::temp_dir().join(format!(
            "diskvault_threat_scan_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        // 1. Archivo limpio normal
        let clean = temp_dir.join("notas.txt");
        fs::write(&clean, b"Hola, este es un documento normal de respaldo.").unwrap();
        assert!(inspect_file_heuristics(&clean).is_none());

        // 2. Doble extensión engañosa
        let decoy = temp_dir.join("factura_2026.pdf.exe");
        fs::write(&decoy, b"dummy").unwrap();
        let decoy_hit = inspect_file_heuristics(&decoy).expect("Debe detectar doble extensión");
        assert_eq!(decoy_hit.severity, ThreatSeverity::Suspicious);

        // 3. Ejecutable Windows PE camuflado como .jpg
        let mut fake_jpg = vec![0u8; 128];
        fake_jpg[0] = b'M';
        fake_jpg[1] = b'Z';
        fake_jpg[60..64].copy_from_slice(&64u32.to_le_bytes());
        fake_jpg[64..68].copy_from_slice(b"PE\0\0");
        let disguised = temp_dir.join("vacaciones.jpg");
        fs::write(&disguised, &fake_jpg).unwrap();
        let disguised_hit =
            inspect_file_heuristics(&disguised).expect("Debe detectar PE camuflado");
        assert_eq!(disguised_hit.severity, ThreatSeverity::Malware);

        // 4. Script PowerShell ofuscado sospechoso
        let script = temp_dir.join("actualizar.ps1");
        fs::write(
            &script,
            b"powershell -w hidden -EncodedCommand SQBFAFgA",
        )
        .unwrap();
        let script_hit = inspect_file_heuristics(&script).expect("Debe detectar script peligroso");
        assert_eq!(script_hit.severity, ThreatSeverity::Suspicious);

        // Escaneo de carpeta completa devuelve los 3 hallazgos ordenados (Malware primero)
        let report = scan_source_for_threats(temp_dir.to_str().unwrap()).unwrap();
        assert!(report.has_threats);
        assert_eq!(report.files_scanned, 4);
        assert_eq!(report.findings.len(), 3);
        assert_eq!(report.findings[0].severity, ThreatSeverity::Malware);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn parsea_salida_de_windows_defender() {
        let sample = "Scanning C:\\Temp\\demo...\nThreat                  : Virus:DOS/EICAR_Test_File\nResources               : 1 total\n    file                : C:\\Temp\\demo\\eicar.txt\n";
        let hits = parse_defender_output(sample, Path::new(r"C:\Temp\demo"));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].engine, "Windows Defender");
        assert_eq!(hits[0].threat_name, "Virus:DOS/EICAR_Test_File");
        assert_eq!(hits[0].file_path, r"C:\Temp\demo\eicar.txt");
    }
}
