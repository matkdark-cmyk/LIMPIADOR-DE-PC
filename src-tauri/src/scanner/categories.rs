use serde::{Deserialize, Serialize};
use std::path::Path;

/// Categorías amigables de clasificación de espacio en disco.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FileSection {
    AppsAndGames,
    Videos,
    Images,
    Audio,
    Documents,
    ArchivesAndInstallers,
    SystemAndOther,
}

impl FileSection {
    /// Lista ordenada fija de las 7 secciones oficiales.
    pub const ALL: [FileSection; 7] = [
        FileSection::AppsAndGames,
        FileSection::Videos,
        FileSection::Images,
        FileSection::Audio,
        FileSection::Documents,
        FileSection::ArchivesAndInstallers,
        FileSection::SystemAndOther,
    ];

    /// Índice estable (0..7) para agregaciones rápidas en arrays fijos.
    pub fn index(self) -> usize {
        match self {
            FileSection::AppsAndGames => 0,
            FileSection::Videos => 1,
            FileSection::Images => 2,
            FileSection::Audio => 3,
            FileSection::Documents => 4,
            FileSection::ArchivesAndInstallers => 5,
            FileSection::SystemAndOther => 6,
        }
    }

    /// Nombre visible en español claro para la interfaz.
    pub fn label_es(self) -> &'static str {
        match self {
            FileSection::AppsAndGames => "Aplicaciones y Juegos",
            FileSection::Videos => "Videos y Multimedia",
            FileSection::Images => "Imágenes y Diseño",
            FileSection::Audio => "Audio y Música",
            FileSection::Documents => "Documentos y Oficina",
            FileSection::ArchivesAndInstallers => "Comprimidos e Instaladores",
            FileSection::SystemAndOther => "Sistema, Caché y Otros",
        }
    }
}

const APP_AND_GAME_DIR_MARKERS: &[&str] = &[
    "program files",
    "program files (x86)",
    "steamlibrary",
    "epic games",
    "xboxgames",
];

const DOWNLOAD_DIR_MARKERS: &[&str] = &["downloads", "descargas"];

const APP_AND_GAME_EXTS: &[&str] = &["exe", "dll", "msi", "pak", "vpk"];
const VIDEO_EXTS: &[&str] = &["mp4", "mkv", "mov", "avi", "wmv", "webm", "flv", "m4v", "ts"];
const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "raw", "cr2", "nef", "psd", "ai", "tiff",
];
const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "ogg", "aac", "m4a", "wma", "opus"];
const DOCUMENT_EXTS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "odt", "epub",
];
const ARCHIVE_EXTS: &[&str] = &[
    "zip", "rar", "7z", "tar", "gz", "iso", "img", "cab", "msix",
];

/// Clasifica un archivo según su extensión y carpetas conocidas de Windows.
pub fn classify_file(path: &Path) -> FileSection {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    let normalized = path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();

    let segments: Vec<&str> = normalized
        .split('\\')
        .filter(|segment| !segment.is_empty())
        .collect();

    // Excluir el nombre del archivo al inspeccionar directorios ancestros
    let dir_segments = if segments.len() > 1 {
        &segments[..segments.len() - 1]
    } else {
        &[][..]
    };

    // 1. Instaladores (.exe / .msi) dentro de Downloads o Descargas -> Comprimidos e Instaladores
    if let Some(ref ext_str) = ext {
        if (ext_str == "exe" || ext_str == "msi")
            && dir_segments
                .iter()
                .any(|seg| DOWNLOAD_DIR_MARKERS.contains(seg))
        {
            return FileSection::ArchivesAndInstallers;
        }
    }

    // 2. Archivos dentro de directorios conocidos de aplicaciones o juegos
    if dir_segments
        .iter()
        .any(|seg| APP_AND_GAME_DIR_MARKERS.contains(seg))
    {
        return FileSection::AppsAndGames;
    }

    // 3. Clasificación por extensión de archivo
    if let Some(ref ext_str) = ext {
        let e = ext_str.as_str();
        if VIDEO_EXTS.contains(&e) {
            return FileSection::Videos;
        }
        if IMAGE_EXTS.contains(&e) {
            return FileSection::Images;
        }
        if AUDIO_EXTS.contains(&e) {
            return FileSection::Audio;
        }
        if DOCUMENT_EXTS.contains(&e) {
            return FileSection::Documents;
        }
        if ARCHIVE_EXTS.contains(&e) {
            return FileSection::ArchivesAndInstallers;
        }
        if APP_AND_GAME_EXTS.contains(&e) {
            return FileSection::AppsAndGames;
        }
    }

    // 4. Resto de archivos, temporales, logs, cachés y sistema
    FileSection::SystemAndOther
}

/// Determina la sección dominante de una carpeta a partir del peso acumulado por sección.
pub fn dominant_section(section_bytes: &[u64; 7]) -> FileSection {
    let mut best_idx = FileSection::SystemAndOther.index();
    let mut best_bytes = 0u64;

    for section in FileSection::ALL {
        let idx = section.index();
        if section_bytes[idx] > best_bytes {
            best_bytes = section_bytes[idx];
            best_idx = idx;
        }
    }

    FileSection::ALL[best_idx]
}

#[cfg(test)]
mod tests {
    use super::{classify_file, dominant_section, FileSection};
    use std::path::Path;

    #[test]
    fn clasifica_extensiones_multimedia_y_documentos() {
        assert_eq!(
            classify_file(Path::new(r"D:\Peliculas\vacaciones_4k.MKV")),
            FileSection::Videos
        );
        assert_eq!(
            classify_file(Path::new(r"C:\Users\Ana\Pictures\portada.PSD")),
            FileSection::Images
        );
        assert_eq!(
            classify_file(Path::new(r"D:\Musica\album\track01.flac")),
            FileSection::Audio
        );
        assert_eq!(
            classify_file(Path::new(r"C:\Users\Ana\Documents\presupuesto.xlsx")),
            FileSection::Documents
        );
    }

    #[test]
    fn distingue_instaladores_en_descargas_vs_programas_instalados() {
        assert_eq!(
            classify_file(Path::new(r"C:\Users\Carlos\Downloads\setup_app.exe")),
            FileSection::ArchivesAndInstallers
        );
        assert_eq!(
            classify_file(Path::new(r"C:\Users\Carlos\Descargas\instalador.msi")),
            FileSection::ArchivesAndInstallers
        );
        assert_eq!(
            classify_file(Path::new(r"D:\Respaldos\windows11.iso")),
            FileSection::ArchivesAndInstallers
        );
        assert_eq!(
            classify_file(Path::new(r"C:\Program Files\MiApp\launcher.exe")),
            FileSection::AppsAndGames
        );
        assert_eq!(
            classify_file(Path::new(r"D:\SteamLibrary\steamapps\common\Juego\textura.png")),
            FileSection::AppsAndGames
        );
        assert_eq!(
            classify_file(Path::new(r"E:\Epic Games\Fortnite\pakchunk0.pak")),
            FileSection::AppsAndGames
        );
    }

    #[test]
    fn clasifica_archivos_de_sistema_y_seccion_dominante() {
        assert_eq!(
            classify_file(Path::new(r"C:\Users\Carlos\AppData\Local\Temp\debug.tmp")),
            FileSection::SystemAndOther
        );
        assert_eq!(
            classify_file(Path::new(r"C:\Windows\Logs\cbs.log")),
            FileSection::SystemAndOther
        );

        let mut totals = [0u64; 7];
        totals[FileSection::Videos.index()] = 12_000_000_000;
        totals[FileSection::Documents.index()] = 500_000;
        assert_eq!(dominant_section(&totals), FileSection::Videos);
    }
}
