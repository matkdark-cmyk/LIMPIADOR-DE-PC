use crate::scanner::engine::ScanState;
use crate::security;
use crate::storage::db::Database;
use jwalk::WalkDir;
use std::path::Path;

/// Calcula el tamaño en bytes de un archivo o directorio (sin seguir enlaces simbólicos).
fn compute_path_size_fallback(target: &Path) -> u64 {
    if target.is_file() {
        return target.metadata().map(|m| m.len()).unwrap_or(0);
    }
    if target.is_dir() {
        let mut sum = 0u64;
        for entry in WalkDir::new(target).follow_links(false).skip_hidden(false) {
            if let Ok(item) = entry {
                if item.file_type().is_file() {
                    if let Ok(meta) = item.metadata() {
                        sum = sum.saturating_add(meta.len());
                    }
                }
            }
        }
        return sum;
    }
    0
}

/// Abre el Explorador de Windows seleccionando el archivo o carpeta indicado.
#[cfg(windows)]
pub fn open_in_explorer(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("La ruta está vacía.".to_string());
    }

    let target = Path::new(trimmed);
    if !target.exists() {
        return Err(format!(
            "No se encontró el elemento en disco: '{trimmed}'. Es posible que ya haya sido movido o eliminado."
        ));
    }

    let sanitized = trimmed.replace('"', "");
    Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{sanitized}\""))
        .spawn()
        .map_err(|err| format!("No se pudo abrir el Explorador de Windows: {err}"))?;

    Ok(())
}

#[cfg(not(windows))]
pub fn open_in_explorer(path: &str) -> Result<(), String> {
    let target = Path::new(path.trim());
    if !target.exists() {
        return Err(format!("La ruta '{path}' no existe."));
    }
    Err("Abrir en el Explorador de Windows solo está disponible en Windows.".to_string())
}

/// Envía un archivo o carpeta de forma segura a la Papelera de Reciclaje de Windows,
/// aplicando la lista negra de seguridad, registrando auditoría en SQLite y actualizando `ScanState`.
pub fn delete_item_to_trash(
    path: &str,
    scan_state: &ScanState,
    db: &Database,
) -> Result<u64, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Debes indicar una ruta válida para enviar a la Papelera.".to_string());
    }

    let target_path = Path::new(trimmed);

    // 1. Guardarraíl obligatorio: jamás tocar rutas críticas del SO
    security::ensure_path_is_not_protected(target_path)?;

    if !target_path.exists() {
        return Err(format!(
            "No se encontró '{trimmed}'. Puede que ya haya sido eliminado o movido."
        ));
    }

    // 2. Tamaño previo (prioriza el índice en memoria para evitar recorrer carpetas grandes dos veces)
    let known_size = scan_state
        .index
        .read()
        .ok()
        .and_then(|guard| guard.as_ref().and_then(|idx| idx.find_known_size(target_path)));

    let bytes_to_free = known_size.unwrap_or_else(|| compute_path_size_fallback(target_path));

    // 3. Envío seguro a la Papelera de Reciclaje de Windows
    trash::delete(target_path).map_err(|err| {
        format!(
            "No se pudo enviar '{}' a la Papelera de Reciclaje: {err}. Verifica que no esté en uso por otro programa o activa el Modo Administrador.",
            target_path.display()
        )
    })?;

    // 4. Registro obligatorio en auditoría SQLite
    let item_name = target_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| trimmed.to_string());

    let _ = db.record_audit_log(
        "analyzer",
        "trash_delete",
        Some(trimmed),
        Some("Papelera de Reciclaje"),
        bytes_to_free as i64,
        "ok",
        Some(&format!(
            "Enviado a la Papelera de Reciclaje: '{item_name}'."
        )),
    );

    // 5. Actualización inmediata del índice en memoria sin forzar re-escaneo
    if let Ok(mut guard) = scan_state.index.write() {
        if let Some(index) = guard.as_mut() {
            index.remove_deleted_path(target_path, bytes_to_free);
        }
    }

    Ok(bytes_to_free)
}
