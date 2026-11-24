use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use xxhash_rust::xxh3::Xxh3;

/// Tamaño del bloque de lectura por streaming (1 MiB) para mantener baja la memoria y alta la velocidad.
pub const HASH_BUFFER_SIZE: usize = 1024 * 1024;

/// Calcula el hash criptográficamente resistente en 128 bits `xxHash3` de un archivo por streaming,
/// soportando pausa y cancelación cooperativa sin cargar el archivo completo en RAM.
pub fn compute_file_xxhash3<F>(
    path: &Path,
    pause_flag: Option<&AtomicBool>,
    cancel_flag: Option<&AtomicBool>,
    mut on_chunk: F,
) -> Result<String, String>
where
    F: FnMut(u64),
{
    let mut file = File::open(path).map_err(|err| {
        format!(
            "No se pudo abrir '{}' para calcular la firma de integridad xxHash3: {err}",
            path.display()
        )
    })?;

    let mut hasher = Xxh3::new();
    let mut buffer = vec![0u8; HASH_BUFFER_SIZE];

    loop {
        if let Some(cancel) = cancel_flag {
            if cancel.load(Ordering::Relaxed) {
                return Err("Operación cancelada por el usuario durante la verificación.".to_string());
            }
        }

        if let Some(pause) = pause_flag {
            while pause.load(Ordering::Relaxed) {
                if let Some(cancel) = cancel_flag {
                    if cancel.load(Ordering::Relaxed) {
                        return Err("Operación cancelada por el usuario.".to_string());
                    }
                }
                thread::sleep(Duration::from_millis(100));
            }
        }

        let bytes_read = file.read(&mut buffer).map_err(|err| {
            format!(
                "Error de lectura al verificar '{}' con xxHash3: {err}",
                path.display()
            )
        })?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
        on_chunk(bytes_read as u64);
    }

    let digest = hasher.digest128();
    Ok(format!("{digest:032x}"))
}

/// Versión simplificada de cálculo de hash `xxHash3` para uso directo o pruebas unitarias.
pub fn compute_file_xxhash3_simple(path: &Path) -> Result<String, String> {
    compute_file_xxhash3(path, None, None, |_| {})
}

#[cfg(test)]
mod tests {
    use super::compute_file_xxhash3_simple;
    use std::fs;

    #[test]
    fn calcula_hash_xxhash3_determinista_y_detecta_cambio_de_un_byte() {
        let dir = std::env::temp_dir().join(format!("diskvault_hash_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let file_a = dir.join("archivo_a.bin");
        let file_b = dir.join("archivo_b.bin");
        let file_c = dir.join("archivo_corrupto.bin");

        let mut payload = vec![0x5Au8; 2_500_000]; // > 2 MiB (múltiples bloques de streaming)
        fs::write(&file_a, &payload).unwrap();
        fs::write(&file_b, &payload).unwrap();

        // Alterar un único byte en medio del archivo
        payload[1_234_567] ^= 0x01;
        fs::write(&file_c, &payload).unwrap();

        let hash_a = compute_file_xxhash3_simple(&file_a).unwrap();
        let hash_b = compute_file_xxhash3_simple(&file_b).unwrap();
        let hash_c = compute_file_xxhash3_simple(&file_c).unwrap();

        assert_eq!(hash_a.len(), 32);
        assert_eq!(hash_a, hash_b, "Dos archivos idénticos deben producir el mismo xxHash3");
        assert_ne!(
            hash_a, hash_c,
            "Un solo byte alterado debe cambiar completamente el hash xxHash3"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
