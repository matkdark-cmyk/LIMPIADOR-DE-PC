use std::path::Path;

/// Directorios raíz protegidos del sistema operativo Windows (insensible a mayúsculas).
/// Nunca se permite eliminar ni reubicar ninguna de estas rutas ni sus contenidos.
const PROTECTED_ROOT_DIRS: &[&str] = &[
    "windows",
    "windows\\system32",
    "windows\\winsxs",
    "boot",
    "system volume information",
    "$recycle.bin",
];

/// Segmentos de ruta siempre protegidos en cualquier volumen o punto de montaje.
const PROTECTED_SEGMENTS: &[&str] = &[
    "system volume information",
    "$recycle.bin",
];

/// Archivos críticos del núcleo / memoria virtual de Windows.
const PROTECTED_SYSTEM_FILES: &[&str] = &[
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
];

/// Normaliza una ruta de Windows a minúsculas, con separador `\`, sin prefijos `\\?\`
/// y sin barras finales sobrantes (excepto en raíces de unidad como `c:\`).
fn normalize_windows_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let replaced = trimmed.replace('/', "\\");

    // Elimina prefijos extendidos de Win32 (\\?\ y \\?\UNC\)
    let lower = replaced.to_lowercase();
    let without_extended = if let Some(rest) = lower.strip_prefix("\\\\?\\unc\\") {
        format!("\\\\{rest}")
    } else if let Some(rest) = lower.strip_prefix("\\\\?\\") {
        rest.to_string()
    } else {
        lower
    };

    // Colapsa barras duplicadas preservando prefijo UNC (\\servidor\recurso)
    let is_unc = without_extended.starts_with("\\\\");
    let mut normalized = String::with_capacity(without_extended.len());
    let mut prev_slash = false;
    for (idx, ch) in without_extended.chars().enumerate() {
        if ch == '\\' {
            if is_unc && idx < 2 {
                normalized.push('\\');
                prev_slash = true;
            } else if !prev_slash {
                normalized.push('\\');
                prev_slash = true;
            }
        } else {
            normalized.push(ch);
            prev_slash = false;
        }
    }

    // Quita barras finales salvo en raíz de unidad (ej. "c:\")
    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }

    normalized
}

/// Extrae la parte relativa tras una letra de unidad (`c:\...` -> `...`).
fn strip_drive_prefix(normalized: &str) -> Option<&str> {
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        if bytes.len() == 2 {
            return Some("");
        }
        if bytes[2] == b'\\' {
            return Some(&normalized[3..]);
        }
    }
    None
}

/// Comprueba si una ruta corresponde a un directorio o archivo protegido de Windows.
///
/// Regla innegociable de seguridad: cualquier ruta devuelta como `true` debe
/// mostrarse como `Protegido` en la UI y bloquearse contra borrado o movimiento.
pub fn is_protected_path(path: &Path) -> bool {
    let normalized = normalize_windows_path(path);
    if normalized.is_empty() {
        return false;
    }

    // 1. Raíces de unidad completa (ej. "C:\" o "C:") siempre protegidas
    if let Some(rel) = strip_drive_prefix(&normalized) {
        if rel.is_empty() {
            return true;
        }

        // 2. Comprobación contra directorios críticos del SO
        for protected_dir in PROTECTED_ROOT_DIRS {
            if rel == *protected_dir
                || (rel.starts_with(protected_dir)
                    && rel.as_bytes().get(protected_dir.len()) == Some(&b'\\'))
            {
                return true;
            }
        }
    } else if let Some(rel) = normalized.strip_prefix('\\') {
        // Rutas relativas a la raíz sin letra de unidad (ej. "\Windows\System32")
        if !normalized.starts_with("\\\\") {
            for protected_dir in PROTECTED_ROOT_DIRS {
                if rel == *protected_dir
                    || (rel.starts_with(protected_dir)
                        && rel.as_bytes().get(protected_dir.len()) == Some(&b'\\'))
                {
                    return true;
                }
            }
        }
    }

    // 3. Segmentos siempre protegidos en cualquier volumen
    let segments: Vec<&str> = normalized
        .split('\\')
        .filter(|segment| !segment.is_empty())
        .collect();

    for segment in &segments {
        if PROTECTED_SEGMENTS.contains(segment) {
            return true;
        }
    }

    // 4. Archivos críticos del sistema (pagefile.sys, hiberfil.sys, swapfile.sys)
    if let Some(file_name) = segments.last() {
        if PROTECTED_SYSTEM_FILES.contains(file_name) {
            return true;
        }
    }

    false
}

/// Valida que una ruta pueda modificarse de forma segura, devolviendo un error claro en español si está protegida.
pub fn ensure_path_is_not_protected(path: &Path) -> Result<(), String> {
    if is_protected_path(path) {
        return Err(format!(
            "Operación bloqueada por seguridad: '{}' es una ruta protegida del sistema operativo Windows.",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ensure_path_is_not_protected, is_protected_path};
    use std::path::Path;

    #[test]
    fn bloquea_directorios_criticos_de_windows() {
        let protected_cases = [
            r"C:\Windows",
            r"c:\windows\",
            r"C:/Windows/System32",
            r"C:\WINDOWS\System32\drivers\etc\hosts",
            r"C:\Windows\WinSxS",
            r"C:\Windows\WinSxS\amd64_microsoft-windows",
            r"C:\Boot",
            r"c:/boot/BCD",
            r"C:\System Volume Information",
            r"D:\System Volume Information\tracking.log",
            r"C:\$Recycle.Bin",
            r"E:\$Recycle.Bin\S-1-5-21-12345",
            r"\\?\C:\Windows\System32",
            r"C:\",
        ];

        for case in protected_cases {
            assert!(
                is_protected_path(Path::new(case)),
                "Se esperaba que '{case}' estuviera protegida"
            );
            assert!(ensure_path_is_not_protected(Path::new(case)).is_err());
        }
    }

    #[test]
    fn bloquea_archivos_criticos_de_memoria_y_hibernacion() {
        let critical_files = [
            r"C:\pagefile.sys",
            r"c:/PAGEFILE.SYS",
            r"C:\hiberfil.sys",
            r"D:\swapfile.sys",
        ];

        for case in critical_files {
            assert!(
                is_protected_path(Path::new(case)),
                "Se esperaba que el archivo crítico '{case}' estuviera protegido"
            );
        }
    }

    #[test]
    fn permite_carpetas_y_archivos_normales_de_usuario() {
        let allowed_cases = [
            r"C:\Users\Carlos\Downloads",
            r"C:\Users\Carlos\Downloads\video_vacaciones.mp4",
            r"D:\Juegos\SteamLibrary\steamapps",
            r"C:\Users\Maria\Documents\windows_notas.txt",
            r"D:\Proyectos\boot_camp\README.md",
            r"C:\WindowsBackup\respaldo_2026.zip",
            r"\\NAS-CASA\Multimedia\Peliculas",
        ];

        for case in allowed_cases {
            assert!(
                !is_protected_path(Path::new(case)),
                "La ruta de usuario '{case}' NO debería marcarse como protegida"
            );
            assert!(ensure_path_is_not_protected(Path::new(case)).is_ok());
        }
    }
}
