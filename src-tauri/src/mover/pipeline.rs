use crate::mover::hasher::compute_file_xxhash3;
use crate::mover::links::{create_transparent_link, is_unc_path, remove_link_only};
use crate::mover::targets::query_destination_space;
use crate::security;
use jwalk::WalkDir;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};

/// Tamaño del bloque de copia por streaming (1 MiB).
const COPY_BUFFER_SIZE: usize = 1024 * 1024;
/// Reintentos automáticos por archivo ante microcortes de red SMB/NAS.
const MAX_COPY_RETRIES: u32 = 3;

/// Modo de migración elegido por el usuario.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferMode {
    /// Copia -> Verifica xxHash3 -> Limpia origen local para liberar espacio.
    ArchiveFree,
    /// Copia -> Verifica xxHash3 -> Reemplaza origen local con Junction/Symlink transparente.
    MoveSymlink,
    /// Copia -> Verifica xxHash3 -> Conserva ambos (respaldo íntegro sin borrar nada).
    CopyBackup,
}

impl TransferMode {
    pub fn as_db_str(self) -> &'static str {
        match self {
            TransferMode::ArchiveFree => "archive_free",
            TransferMode::MoveSymlink => "move_symlink",
            TransferMode::CopyBackup => "copy_backup",
        }
    }
}

/// Fase activa del pipeline de 3 fases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferPhase {
    Preparing,
    Copying,
    Verifying,
    Cleaning,
    Completed,
    Failed,
    Cancelled,
}

/// Solicitud de inicio de transferencia enviada desde el asistente frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub source_path: String,
    pub dest_root: String,
    pub mode: TransferMode,
    /// Si es `true` en `ArchiveFree` o `MoveSymlink`, envía la copia local antigua a la Papelera tras verificar.
    pub send_local_to_trash: bool,
}

/// Diagnóstico previo antes de iniciar la copia (conteo, tamaño, espacio disponible).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPreflight {
    pub source_path: String,
    pub source_name: String,
    pub is_dir: bool,
    pub resolved_dest_path: String,
    pub files_count: u64,
    pub total_bytes: u64,
    pub dest_free_bytes: u64,
    pub dest_total_bytes: u64,
    pub fits_in_destination: bool,
    pub dest_already_exists: bool,
    pub dest_is_network_unc: bool,
}

/// Evento emitido periódicamente (~150ms) por Tauri (`"transfer-progress"`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub phase: TransferPhase,
    pub paused: bool,
    pub current_file: String,
    pub files_completed: u64,
    pub files_total: u64,
    pub bytes_processed: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: f64,
    pub eta_seconds: Option<u64>,
    pub percent: f64,
    pub retries_count: u32,
}

/// Resultado final de la operación de transferencia.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub source_path: String,
    pub dest_path: String,
    pub mode: TransferMode,
    pub files_count: u64,
    pub total_bytes: u64,
    pub status: String,
    pub duration_ms: u64,
    pub retries_count: u32,
    pub symlink_created: bool,
    pub local_space_freed: bool,
    pub summary_message: String,
}

/// Estado administrado por Tauri para controlar pausa, reanudación y cancelación en vivo.
pub struct MoverState {
    pub is_running: Arc<AtomicBool>,
    pub pause_flag: Arc<AtomicBool>,
    pub cancel_flag: Arc<AtomicBool>,
}

impl Default for MoverState {
    fn default() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            pause_flag: Arc::new(AtomicBool::new(false)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Entrada de archivo inventariada en el origen.
#[derive(Debug, Clone)]
pub struct FileManifestItem {
    pub source_abs: PathBuf,
    pub dest_abs: PathBuf,
    pub relative_display: String,
    pub size_bytes: u64,
    pub mtime: Option<SystemTime>,
}

fn normalize_for_compare(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('/', "\\").to_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// Resuelve la ruta final en el destino (`<dest_root>\<nombre_origen>`).
pub fn resolve_final_destination(source: &Path, dest_root: &Path) -> Result<(String, PathBuf), String> {
    let source_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| {
            "No se puede migrar una raíz de unidad completa. Selecciona una carpeta o archivo específico."
                .to_string()
        })?;

    Ok((source_name.clone(), dest_root.join(source_name)))
}

/// Inventaría archivos y subcarpetas vacías del origen (sin seguir enlaces simbólicos).
fn build_manifest(
    source: &Path,
    final_dest: &Path,
    cancel_flag: Option<&AtomicBool>,
) -> Result<(Vec<FileManifestItem>, Vec<PathBuf>, u64), String> {
    let mut files = Vec::new();
    let mut empty_or_all_dirs = Vec::new();
    let mut total_bytes: u64 = 0;

    if source.is_file() {
        let meta = fs::metadata(source)
            .map_err(|err| format!("No se pudo leer metadatos de '{}': {err}", source.display()))?;
        let size = meta.len();
        let mtime = meta.modified().ok();
        let rel = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| source.to_string_lossy().to_string());

        files.push(FileManifestItem {
            source_abs: source.to_path_buf(),
            dest_abs: final_dest.to_path_buf(),
            relative_display: rel,
            size_bytes: size,
            mtime,
        });
        return Ok((files, empty_or_all_dirs, size));
    }

    empty_or_all_dirs.push(final_dest.to_path_buf());

    for entry_res in WalkDir::new(source).follow_links(false).skip_hidden(false) {
        if let Some(cancel) = cancel_flag {
            if cancel.load(Ordering::Relaxed) {
                return Err("Operación cancelada por el usuario durante la preparación.".to_string());
            }
        }

        let entry = entry_res.map_err(|err| {
            format!(
                "No se pudo leer un elemento dentro de '{}': {err}. Verifica que no esté bloqueado por permisos.",
                source.display()
            )
        })?;

        let entry_path = entry.path();
        if entry_path == source {
            continue;
        }

        let file_type = entry.file_type();
        if file_type.is_symlink() {
            continue;
        }

        let rel = entry_path
            .strip_prefix(source)
            .map_err(|err| format!("Error al calcular ruta relativa: {err}"))?;
        let dest_abs = final_dest.join(rel);

        if file_type.is_dir() {
            empty_or_all_dirs.push(dest_abs);
        } else if file_type.is_file() {
            let meta = entry.metadata().map_err(|err| {
                format!(
                    "No se pudo leer tamaño de '{}': {err}",
                    entry_path.display()
                )
            })?;
            let size = meta.len();
            total_bytes = total_bytes.saturating_add(size);

            files.push(FileManifestItem {
                source_abs: entry_path.clone(),
                dest_abs,
                relative_display: rel.to_string_lossy().to_string(),
                size_bytes: size,
                mtime: meta.modified().ok(),
            });
        }
    }

    Ok((files, empty_or_all_dirs, total_bytes))
}

/// Realiza el diagnóstico previo antes de comenzar la transferencia.
pub fn preflight_transfer(source_raw: &str, dest_root_raw: &str) -> Result<TransferPreflight, String> {
    let source = Path::new(source_raw.trim());
    let dest_root = Path::new(dest_root_raw.trim());

    security::ensure_path_is_not_protected(source)?;

    if !source.exists() {
        return Err(format!(
            "La ruta de origen no existe: '{}'.",
            source.display()
        ));
    }
    if !dest_root.exists() || !dest_root.is_dir() {
        return Err(format!(
            "La carpeta de destino '{}' no existe o no está accesible en este momento.",
            dest_root.display()
        ));
    }

    let (source_name, final_dest) = resolve_final_destination(source, dest_root)?;

    let src_norm = normalize_for_compare(source);
    let dst_norm = normalize_for_compare(&final_dest);
    if dst_norm == src_norm || dst_norm.starts_with(&format!("{src_norm}\\")) {
        return Err(
            "La carpeta de destino no puede estar dentro de la carpeta de origen.".to_string(),
        );
    }

    let (files, _, total_bytes) = build_manifest(source, &final_dest, None)?;
    let (dest_free_bytes, dest_total_bytes) = query_destination_space(dest_root).unwrap_or((0, 0));

    let fits_in_destination = dest_free_bytes == 0 && dest_total_bytes == 0
        || dest_free_bytes >= total_bytes;

    Ok(TransferPreflight {
        source_path: source.to_string_lossy().to_string(),
        source_name,
        is_dir: source.is_dir(),
        resolved_dest_path: final_dest.to_string_lossy().to_string(),
        files_count: files.len() as u64,
        total_bytes,
        dest_free_bytes,
        dest_total_bytes,
        fits_in_destination,
        dest_already_exists: final_dest.exists(),
        dest_is_network_unc: is_unc_path(dest_root),
    })
}

fn check_pause_and_cancel(pause_flag: &AtomicBool, cancel_flag: &AtomicBool) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("Transferencia cancelada por el usuario.".to_string());
    }
    while pause_flag.load(Ordering::Relaxed) {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Transferencia cancelada por el usuario.".to_string());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}

/// Copia un archivo bloque a bloque (1 MiB) preservando fecha de modificación y soportando pausa/cancelación.
fn copy_single_file_streaming<F>(
    item: &FileManifestItem,
    pause_flag: &AtomicBool,
    cancel_flag: &AtomicBool,
    mut on_bytes: F,
) -> Result<(), String>
where
    F: FnMut(u64),
{
    if let Some(parent) = item.dest_abs.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "No se pudo crear la carpeta destino '{}': {err}",
                parent.display()
            )
        })?;
    }

    let mut src_file = File::open(&item.source_abs).map_err(|err| {
        format!(
            "No se pudo abrir archivo origen '{}': {err}",
            item.source_abs.display()
        )
    })?;

    let mut dst_file = File::create(&item.dest_abs).map_err(|err| {
        format!(
            "No se pudo crear archivo destino '{}': {err}",
            item.dest_abs.display()
        )
    })?;

    let mut buffer = vec![0u8; COPY_BUFFER_SIZE];

    loop {
        check_pause_and_cancel(pause_flag, cancel_flag)?;

        let read_n = src_file.read(&mut buffer).map_err(|err| {
            format!(
                "Error de lectura en '{}': {err}",
                item.source_abs.display()
            )
        })?;
        if read_n == 0 {
            break;
        }

        dst_file.write_all(&buffer[..read_n]).map_err(|err| {
            format!(
                "Error de escritura hacia el destino '{}': {err}",
                item.dest_abs.display()
            )
        })?;

        on_bytes(read_n as u64);
    }

    dst_file.flush().map_err(|err| {
        format!(
            "No se pudo vaciar el búfer de escritura para '{}': {err}",
            item.dest_abs.display()
        )
    })?;
    if let Some(mtime) = item.mtime {
        let _ = dst_file.set_modified(mtime);
    }
    drop(dst_file);

    Ok(())
}

/// Fase 2 (Regla de Oro): verifica conteo, tamaño exacto en bytes y hash `xxHash3`
/// de cada archivo entre el origen local y el destino.
///
/// Si falla un solo archivo o existe la mínima discrepancia, retorna `Err` inmediatamente
/// y jamás permite avanzar a la Fase 3 de limpieza local.
pub fn verify_manifest_xxhash3<F>(
    manifest: &[FileManifestItem],
    pause_flag: &AtomicBool,
    cancel_flag: &AtomicBool,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(&str, u64, u64),
{
    let mut verified_bytes: u64 = 0;

    for (idx, item) in manifest.iter().enumerate() {
        check_pause_and_cancel(pause_flag, cancel_flag)?;

        if !item.dest_abs.exists() {
            return Err(format!(
                "Falló la verificación de integridad: falta el archivo '{}' en el destino. El origen local permanece 100% intacto.",
                item.relative_display
            ));
        }

        let dest_meta = fs::metadata(&item.dest_abs).map_err(|err| {
            format!(
                "Falló la verificación al leer metadatos de '{}' en el destino: {err}. El origen local permanece intacto.",
                item.relative_display
            )
        })?;

        if dest_meta.len() != item.size_bytes {
            return Err(format!(
                "Discrepancia de tamaño en '{}': origen tiene {} bytes y destino tiene {} bytes. Operación detenida: NO se eliminó nada en tu PC.",
                item.relative_display,
                item.size_bytes,
                dest_meta.len()
            ));
        }

        let source_hash = compute_file_xxhash3(
            &item.source_abs,
            Some(pause_flag),
            Some(cancel_flag),
            |_| {},
        )?;

        let dest_hash = compute_file_xxhash3(
            &item.dest_abs,
            Some(pause_flag),
            Some(cancel_flag),
            |chunk_bytes| {
                verified_bytes = verified_bytes.saturating_add(chunk_bytes);
                on_progress(&item.relative_display, idx as u64, verified_bytes);
            },
        )?;

        if source_hash != dest_hash {
            return Err(format!(
                "Discrepancia de integridad xxHash3 en '{}' (origen {} != destino {}). Operación detenida inmediatamente: tu origen local NO ha sido modificado ni borrado.",
                item.relative_display, source_hash, dest_hash
            ));
        }

        on_progress(&item.relative_display, (idx + 1) as u64, verified_bytes);
    }

    Ok(())
}

/// Fase 3 (condicionada a verificación 100% exitosa): ejecuta la política de limpieza local o enlace.
fn apply_phase3_cleanup(
    source: &Path,
    final_dest: &Path,
    mode: TransferMode,
    send_local_to_trash: bool,
) -> Result<(bool, bool, String), String> {
    match mode {
        TransferMode::CopyBackup => Ok((
            false,
            false,
            "Copia verificada con xxHash3 al 100%. Tus archivos originales se conservan intactos en tu PC."
                .to_string(),
        )),

        TransferMode::ArchiveFree => {
            if send_local_to_trash {
                trash::delete(source).map_err(|err| {
                    format!(
                        "La copia en el destino se verificó correctamente, pero no se pudo enviar el origen local a la Papelera: {err}."
                    )
                })?;
                Ok((
                    false,
                    true,
                    "Respaldo verificado con xxHash3 al 100% y copia local enviada de forma segura a la Papelera de Reciclaje."
                        .to_string(),
                ))
            } else {
                if source.is_dir() {
                    fs::remove_dir_all(source)
                } else {
                    fs::remove_file(source)
                }
                .map_err(|err| {
                    format!(
                        "La copia en el destino se verificó correctamente, pero no se pudo liberar el origen local (puede estar en uso por otro programa): {err}."
                    )
                })?;
                Ok((
                    false,
                    true,
                    "Respaldo verificado con xxHash3 al 100% y espacio local liberado en tu PC."
                        .to_string(),
                ))
            }
        }

        TransferMode::MoveSymlink => {
            let is_dir = source.is_dir();
            let parent = source.parent().ok_or_else(|| {
                "No se pudo determinar la carpeta contenedora del origen para crear el enlace."
                    .to_string()
            })?;
            let orig_name = source
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "item".to_string());

            let backup_name = format!(
                "{orig_name}.__diskvault_old_{}",
                chrono::Utc::now().timestamp_millis()
            );
            let backup_path = parent.join(backup_name);

            // Paso atómico 1: apartar el original sin destruirlo todavía
            fs::rename(source, &backup_path).map_err(|err| {
                format!(
                    "Copia verificada en destino, pero no se pudo renombrar el origen local para crear el enlace (cierra programas que estén usando esta carpeta): {err}."
                )
            })?;

            // Paso atómico 2: crear Junction (local) o Symlink (NAS UNC)
            if let Err(link_err) = create_transparent_link(final_dest, source, is_dir) {
                // Rollback inmediato: restaurar carpeta original exactamente como estaba
                let _ = fs::rename(&backup_path, source);
                return Err(format!(
                    "{link_err} Se restauró tu carpeta local sin pérdidas; la copia verificada sigue guardada en el destino."
                ));
            }

            // Paso atómico 3: comprobar que el enlace se resuelve y es accesible
            let link_readable = if is_dir {
                fs::read_dir(source).is_ok()
            } else {
                fs::metadata(source).is_ok()
            };

            if !link_readable {
                let _ = remove_link_only(source);
                let _ = fs::rename(&backup_path, source);
                return Err(
                    "El enlace creado no pudo leerse correctamente. Se restauró tu carpeta local original sin pérdidas."
                        .to_string(),
                );
            }

            // Paso atómico 4: eliminar el respaldo local apartado
            let remove_result = if send_local_to_trash {
                trash::delete(&backup_path).map_err(|e| e.to_string())
            } else if backup_path.is_dir() {
                fs::remove_dir_all(&backup_path).map_err(|e| e.to_string())
            } else {
                fs::remove_file(&backup_path).map_err(|e| e.to_string())
            };

            if let Err(rem_err) = remove_result {
                return Err(format!(
                    "El enlace transparente ya está activo y verificado, pero quedó la carpeta temporal '{}' pendiente de borrar: {rem_err}",
                    backup_path.display()
                ));
            }

            Ok((
                true,
                true,
                "Carpeta migrada con verificación xxHash3 al 100% y reemplazada por un enlace transparente."
                    .to_string(),
            ))
        }
    }
}

/// Ejecuta el pipeline completo de 3 fases (bloqueante, pensado para `spawn_blocking`).
pub fn execute_safe_transfer(
    request: &TransferRequest,
    pause_flag: Arc<AtomicBool>,
    cancel_flag: Arc<AtomicBool>,
    app_handle: Option<AppHandle>,
) -> Result<TransferResult, (String, String, u64, u64, u64)> {
    let started = Instant::now();
    let source = Path::new(request.source_path.trim());

    let fail = |status: &str, msg: String, files: u64, bytes: u64| {
        (
            status.to_string(),
            msg,
            files,
            bytes,
            started.elapsed().as_millis() as u64,
        )
    };

    if let Err(err) = security::ensure_path_is_not_protected(source) {
        return Err(fail("failed_source_intact", err, 0, 0));
    }

    let preflight = preflight_transfer(&request.source_path, &request.dest_root)
        .map_err(|err| fail("failed_source_intact", err, 0, 0))?;

    if preflight.dest_already_exists {
        return Err(fail(
            "failed_source_intact",
            format!(
                "Ya existe un elemento llamado '{}' en el destino seleccionado. Elige otra subcarpeta para evitar sobrescribir respaldos anteriores.",
                preflight.source_name
            ),
            preflight.files_count,
            preflight.total_bytes,
        ));
    }

    if !preflight.fits_in_destination {
        return Err(fail(
            "failed_source_intact",
            format!(
                "Espacio insuficiente en el destino: se necesitan {} bytes y solo hay {} bytes disponibles.",
                preflight.total_bytes, preflight.dest_free_bytes
            ),
            preflight.files_count,
            preflight.total_bytes,
        ));
    }

    let final_dest = PathBuf::from(&preflight.resolved_dest_path);

    let emit_progress = |payload: TransferProgress| {
        if let Some(ref handle) = app_handle {
            let _ = handle.emit("transfer-progress", payload);
        }
    };

    emit_progress(TransferProgress {
        phase: TransferPhase::Preparing,
        paused: false,
        current_file: preflight.source_name.clone(),
        files_completed: 0,
        files_total: preflight.files_count,
        bytes_processed: 0,
        total_bytes: preflight.total_bytes,
        speed_bytes_per_sec: 0.0,
        eta_seconds: None,
        percent: 0.0,
        retries_count: 0,
    });

    let (manifest, all_dirs, total_bytes) =
        build_manifest(source, &final_dest, Some(&cancel_flag)).map_err(|err| {
            let st = if cancel_flag.load(Ordering::Relaxed) {
                "cancelled_source_intact"
            } else {
                "failed_source_intact"
            };
            fail(st, err, preflight.files_count, preflight.total_bytes)
        })?;

    let files_total = manifest.len() as u64;

    // Crea también carpetas vacías del árbol original
    for dir_path in &all_dirs {
        if let Err(err) = fs::create_dir_all(dir_path) {
            return Err(fail(
                "failed_source_intact",
                format!(
                    "No se pudo crear la carpeta '{}' en el destino: {err}",
                    dir_path.display()
                ),
                files_total,
                total_bytes,
            ));
        }
    }

    // ==================== FASE 1: COPIA POR STREAMING CON REINTENTOS ====================
    let copy_started = Instant::now();
    let mut last_emit = Instant::now();
    let mut bytes_copied_committed: u64 = 0;
    let mut retries_count: u32 = 0;

    for (idx, item) in manifest.iter().enumerate() {
        let mut attempt: u32 = 0;
        loop {
            if let Err(err) = check_pause_and_cancel(&pause_flag, &cancel_flag) {
                emit_progress(TransferProgress {
                    phase: TransferPhase::Cancelled,
                    paused: false,
                    current_file: item.relative_display.clone(),
                    files_completed: idx as u64,
                    files_total,
                    bytes_processed: bytes_copied_committed,
                    total_bytes,
                    speed_bytes_per_sec: 0.0,
                    eta_seconds: None,
                    percent: 0.0,
                    retries_count,
                });
                return Err(fail("cancelled_source_intact", err, files_total, total_bytes));
            }

            let mut file_bytes_so_far: u64 = 0;
            let copy_res = copy_single_file_streaming(item, &pause_flag, &cancel_flag, |chunk| {
                file_bytes_so_far = file_bytes_so_far.saturating_add(chunk);
                if last_emit.elapsed() >= Duration::from_millis(150) {
                    let overall_bytes = bytes_copied_committed.saturating_add(file_bytes_so_far);
                    let elapsed_secs = copy_started.elapsed().as_secs_f64().max(0.05);
                    let speed = overall_bytes as f64 / elapsed_secs;
                    let remaining = total_bytes.saturating_sub(overall_bytes);
                    let eta = if speed > 1.0 {
                        Some((remaining as f64 / speed).ceil() as u64)
                    } else {
                        None
                    };
                    let pct = if total_bytes > 0 {
                        ((overall_bytes as f64 / total_bytes as f64) * 100.0).min(100.0)
                    } else {
                        100.0
                    };

                    emit_progress(TransferProgress {
                        phase: TransferPhase::Copying,
                        paused: pause_flag.load(Ordering::Relaxed),
                        current_file: item.relative_display.clone(),
                        files_completed: idx as u64,
                        files_total,
                        bytes_processed: overall_bytes,
                        total_bytes,
                        speed_bytes_per_sec: speed,
                        eta_seconds: eta,
                        percent: (pct * 10.0).round() / 10.0,
                        retries_count,
                    });
                    last_emit = Instant::now();
                }
            });

            match copy_res {
                Ok(()) => {
                    bytes_copied_committed = bytes_copied_committed.saturating_add(item.size_bytes);
                    break;
                }
                Err(err) => {
                    if cancel_flag.load(Ordering::Relaxed) {
                        return Err(fail("cancelled_source_intact", err, files_total, total_bytes));
                    }
                    attempt += 1;
                    if attempt <= MAX_COPY_RETRIES {
                        retries_count += 1;
                        let _ = fs::remove_file(&item.dest_abs);
                        let backoff_ms = match attempt {
                            1 => 500,
                            2 => 1500,
                            _ => 3000,
                        };
                        thread::sleep(Duration::from_millis(backoff_ms));
                        continue;
                    } else {
                        return Err(fail(
                            "failed_source_intact",
                            format!(
                                "Error persistente al copiar '{}' tras {MAX_COPY_RETRIES} reintentos automáticos: {err}. Tu origen local sigue intacto.",
                                item.relative_display
                            ),
                            files_total,
                            total_bytes,
                        ));
                    }
                }
            }
        }
    }

    // ==================== FASE 2: VERIFICACIÓN DE INTEGRIDAD xxHash3 ====================
    let verify_started = Instant::now();
    let mut last_verify_emit = Instant::now();

    emit_progress(TransferProgress {
        phase: TransferPhase::Verifying,
        paused: false,
        current_file: "Iniciando verificación xxHash3...".to_string(),
        files_completed: 0,
        files_total,
        bytes_processed: 0,
        total_bytes,
        speed_bytes_per_sec: 0.0,
        eta_seconds: None,
        percent: 0.0,
        retries_count,
    });

    if let Err(err) =
        verify_manifest_xxhash3(&manifest, &pause_flag, &cancel_flag, |rel, done, bytes| {
            if last_verify_emit.elapsed() >= Duration::from_millis(150) || done == files_total {
                let elapsed_secs = verify_started.elapsed().as_secs_f64().max(0.05);
                let speed = bytes as f64 / elapsed_secs;
                let remaining = total_bytes.saturating_sub(bytes);
                let eta = if speed > 1.0 {
                    Some((remaining as f64 / speed).ceil() as u64)
                } else {
                    None
                };
                let pct = if total_bytes > 0 {
                    ((bytes as f64 / total_bytes as f64) * 100.0).min(100.0)
                } else {
                    100.0
                };

                emit_progress(TransferProgress {
                    phase: TransferPhase::Verifying,
                    paused: pause_flag.load(Ordering::Relaxed),
                    current_file: rel.to_string(),
                    files_completed: done,
                    files_total,
                    bytes_processed: bytes,
                    total_bytes,
                    speed_bytes_per_sec: speed,
                    eta_seconds: eta,
                    percent: (pct * 10.0).round() / 10.0,
                    retries_count,
                });
                last_verify_emit = Instant::now();
            }
        })
    {
        let status = if cancel_flag.load(Ordering::Relaxed) {
            "cancelled_source_intact"
        } else {
            "failed_source_intact"
        };
        emit_progress(TransferProgress {
            phase: if status == "cancelled_source_intact" {
                TransferPhase::Cancelled
            } else {
                TransferPhase::Failed
            },
            paused: false,
            current_file: "Verificación detenida — origen local intacto".to_string(),
            files_completed: 0,
            files_total,
            bytes_processed: 0,
            total_bytes,
            speed_bytes_per_sec: 0.0,
            eta_seconds: None,
            percent: 0.0,
            retries_count,
        });
        return Err(fail(status, err, files_total, total_bytes));
    }

    // ==================== FASE 3: LIMPIEZA LOCAL CONDICIONADA ====================
    emit_progress(TransferProgress {
        phase: TransferPhase::Cleaning,
        paused: false,
        current_file: preflight.source_name.clone(),
        files_completed: files_total,
        files_total,
        bytes_processed: total_bytes,
        total_bytes,
        speed_bytes_per_sec: 0.0,
        eta_seconds: Some(0),
        percent: 100.0,
        retries_count,
    });

    let (symlink_created, local_space_freed, summary_message) =
        apply_phase3_cleanup(source, &final_dest, request.mode, request.send_local_to_trash)
            .map_err(|err| fail("failed_source_intact", err, files_total, total_bytes))?;

    let duration_ms = started.elapsed().as_millis() as u64;

    emit_progress(TransferProgress {
        phase: TransferPhase::Completed,
        paused: false,
        current_file: final_dest.to_string_lossy().to_string(),
        files_completed: files_total,
        files_total,
        bytes_processed: total_bytes,
        total_bytes,
        speed_bytes_per_sec: 0.0,
        eta_seconds: Some(0),
        percent: 100.0,
        retries_count,
    });

    Ok(TransferResult {
        source_path: source.to_string_lossy().to_string(),
        dest_path: final_dest.to_string_lossy().to_string(),
        mode: request.mode,
        files_count: files_total,
        total_bytes,
        status: "verified_completed".to_string(),
        duration_ms,
        retries_count,
        symlink_created,
        local_space_freed,
        summary_message,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_manifest, execute_safe_transfer, verify_manifest_xxhash3, TransferMode,
        TransferRequest,
    };
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    #[test]
    fn pipeline_archive_free_verifica_xxhash3_y_libera_origen() {
        let base = std::env::temp_dir().join(format!(
            "diskvault_pipeline_ok_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        let src_folder = base.join("Origen").join("Vacaciones");
        let dst_root = base.join("DestinoNAS");
        fs::create_dir_all(src_folder.join("Sub")).unwrap();
        fs::create_dir_all(&dst_root).unwrap();

        fs::write(src_folder.join("foto1.jpg"), vec![0x11u8; 8192]).unwrap();
        fs::write(src_folder.join("Sub").join("video.mp4"), vec![0x22u8; 65536]).unwrap();

        let req = TransferRequest {
            source_path: src_folder.to_string_lossy().to_string(),
            dest_root: dst_root.to_string_lossy().to_string(),
            mode: TransferMode::ArchiveFree,
            send_local_to_trash: false,
        };

        let result = execute_safe_transfer(
            &req,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            None,
        )
        .expect("La transferencia válida debía completarse");

        assert_eq!(result.status, "verified_completed");
        assert_eq!(result.files_count, 2);
        assert!(result.local_space_freed);
        assert!(!src_folder.exists(), "El origen debía liberarse tras verificar xxHash3");
        assert!(dst_root.join("Vacaciones").join("foto1.jpg").exists());
        assert!(dst_root.join("Vacaciones").join("Sub").join("video.mp4").exists());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn detiene_verificacion_si_un_byte_esta_corrupto_y_mantiene_origen_intacto() {
        let base = std::env::temp_dir().join(format!(
            "diskvault_pipeline_corrupt_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        let src_folder = base.join("Origen").join("Documentos");
        let dst_folder = base.join("DestinoNAS").join("Documentos");
        fs::create_dir_all(&src_folder).unwrap();
        fs::create_dir_all(&dst_folder).unwrap();

        let original_data = vec![0xABu8; 16384];
        let mut corrupted_data = original_data.clone();
        corrupted_data[9000] ^= 0xFF;

        fs::write(src_folder.join("contrato.pdf"), &original_data).unwrap();
        fs::write(dst_folder.join("contrato.pdf"), &corrupted_data).unwrap();

        let (manifest, _, _) = build_manifest(&src_folder, &dst_folder, None).unwrap();
        let pause = AtomicBool::new(false);
        let cancel = AtomicBool::new(false);

        let verify_res = verify_manifest_xxhash3(&manifest, &pause, &cancel, |_, _, _| {});
        assert!(
            verify_res.is_err(),
            "Debe fallar inmediatamente ante cualquier discrepancia xxHash3"
        );
        assert!(
            src_folder.join("contrato.pdf").exists(),
            "El archivo original local debe permanecer 100% intacto"
        );

        let _ = fs::remove_dir_all(&base);
    }
}
