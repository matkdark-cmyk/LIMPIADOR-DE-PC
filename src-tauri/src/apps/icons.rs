use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use image::imageops::FilterType;
use image::ImageFormat;
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// Limpia una cadena `DisplayIcon` del Registro de Windows (ej. `"C:\App\app.exe",0` o `C:\App\icon.ico`)
/// devolviendo `(ruta_archivo, indice_icono)`.
pub fn parse_display_icon_spec(raw: &str) -> Option<(PathBuf, i32)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Caso 1: Ruta entre comillas: "C:\Ruta Con Espacios\app.exe",0 o "C:\Ruta\app.exe,0"
    if let Some(after_open) = trimmed.strip_prefix('"') {
        if let Some(close_idx) = after_open.find('"') {
            let inside = &after_open[..close_idx];
            let outside = after_open[close_idx + 1..].trim();

            if let Some(idx_str) = outside.strip_prefix(',') {
                let icon_idx = idx_str.trim().parse::<i32>().unwrap_or(0);
                return Some((PathBuf::from(inside.trim()), icon_idx));
            }

            if let Some((p, idx)) = split_trailing_comma_index(inside) {
                return Some((PathBuf::from(p), idx));
            }

            return Some((PathBuf::from(inside.trim()), 0));
        }
    }

    // Caso 2: Sin comillas con índice opcional al final
    if let Some((p, idx)) = split_trailing_comma_index(trimmed) {
        return Some((PathBuf::from(p), idx));
    }

    Some((PathBuf::from(trimmed), 0))
}

fn split_trailing_comma_index(input: &str) -> Option<(&str, i32)> {
    let comma_pos = input.rfind(',')?;
    let maybe_index = input[comma_pos + 1..].trim();
    let parsed = maybe_index.parse::<i32>().ok()?;
    let path_part = input[..comma_pos].trim().trim_matches('"');
    if path_part.is_empty() {
        return None;
    }
    Some((path_part, parsed))
}

fn encode_rgba_to_data_url(width: u32, height: u32, rgba: Vec<u8>) -> Option<String> {
    let img = image::RgbaImage::from_raw(width, height, rgba)?;
    let dyn_img = image::DynamicImage::ImageRgba8(img);
    let resized = if width > 48 || height > 48 {
        dyn_img.resize_exact(32, 32, FilterType::Triangle)
    } else {
        dyn_img
    };

    let mut png_bytes = Cursor::new(Vec::new());
    resized.write_to(&mut png_bytes, ImageFormat::Png).ok()?;
    let b64 = BASE64_STANDARD.encode(png_bytes.into_inner());
    Some(format!("data:image/png;base64,{b64}"))
}

fn extract_from_image_file(path: &Path) -> Option<String> {
    let dyn_img = image::open(path).ok()?;
    let resized = dyn_img.resize_exact(32, 32, FilterType::Triangle);
    let mut png_bytes = Cursor::new(Vec::new());
    resized.write_to(&mut png_bytes, ImageFormat::Png).ok()?;
    let b64 = BASE64_STANDARD.encode(png_bytes.into_inner());
    Some(format!("data:image/png;base64,{b64}"))
}

/// Extrae el ícono desde un `.exe` o `.dll` de Windows usando `ExtractIconExW` + `GetDIBits`.
#[cfg(windows)]
fn extract_from_pe_windows(path: &Path, icon_index: i32) -> Option<String> {
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
    };
    use windows::Win32::UI::Shell::ExtractIconExW;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut hicon_large = HICON::default();
        let extracted = ExtractIconExW(
            PCWSTR(wide_path.as_ptr()),
            icon_index,
            Some(&mut hicon_large),
            None,
            1,
        );

        if extracted == 0 || hicon_large.is_invalid() {
            return None;
        }

        let mut icon_info = ICONINFO::default();
        if GetIconInfo(hicon_large, &mut icon_info).is_err() {
            let _ = DestroyIcon(hicon_large);
            return None;
        }

        let result = (|| -> Option<String> {
            if icon_info.hbmColor.is_invalid() {
                return None;
            }

            let mut bmp = BITMAP::default();
            let got_obj = GetObjectW(
                icon_info.hbmColor.into(),
                size_of::<BITMAP>() as i32,
                Some((&mut bmp as *mut BITMAP).cast()),
            );
            if got_obj == 0 || bmp.bmWidth <= 0 || bmp.bmHeight <= 0 {
                return None;
            }

            let width = bmp.bmWidth as usize;
            let height = bmp.bmHeight as usize;
            if width > 512 || height > 512 {
                return None;
            }

            let hdc = CreateCompatibleDC(HDC::default());
            if hdc.is_invalid() {
                return None;
            }

            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32), // Top-down para leer filas de arriba a abajo
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut pixels = vec![0u8; width * height * 4];
            let lines = GetDIBits(
                hdc,
                icon_info.hbmColor,
                0,
                height as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            let _ = DeleteDC(hdc);

            if lines == 0 {
                return None;
            }

            // Convertir BGRA (Win32) a RGBA (PNG)
            let mut has_non_zero_alpha = false;
            for px in pixels.chunks_exact_mut(4) {
                px.swap(0, 2);
                if px[3] != 0 {
                    has_non_zero_alpha = true;
                }
            }
            if !has_non_zero_alpha {
                for px in pixels.chunks_exact_mut(4) {
                    px[3] = 255;
                }
            }

            encode_rgba_to_data_url(width as u32, height as u32, pixels)
        })();

        if !icon_info.hbmColor.is_invalid() {
            let _ = DeleteObject(icon_info.hbmColor.into());
        }
        if !icon_info.hbmMask.is_invalid() {
            let _ = DeleteObject(icon_info.hbmMask.into());
        }
        let _ = DestroyIcon(hicon_large);

        result
    }
}

#[cfg(not(windows))]
fn extract_from_pe_windows(_path: &Path, _icon_index: i32) -> Option<String> {
    None
}

/// Extrae un ícono como `data:image/png;base64,...` de forma tolerante a fallos.
/// Nunca devuelve error ni interrumpe el inventario si un ícono falta o está dañado.
pub fn extract_icon_data_url(display_icon: Option<&str>) -> Option<String> {
    let raw = display_icon?;
    let (path, index) = parse_display_icon_spec(raw)?;
    if !path.exists() || !path.is_file() {
        return None;
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    if ext == "ico" || ext == "png" {
        if let Some(url) = extract_from_image_file(&path) {
            return Some(url);
        }
    }

    if ext == "exe" || ext == "dll" || ext == "ico" {
        return extract_from_pe_windows(&path, index);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::parse_display_icon_spec;
    use std::path::PathBuf;

    #[test]
    fn parsea_formatos_comunes_de_display_icon() {
        assert_eq!(
            parse_display_icon_spec(r#""C:\Program Files\App\app.exe",0"#),
            Some((PathBuf::from(r"C:\Program Files\App\app.exe"), 0))
        );
        assert_eq!(
            parse_display_icon_spec(r#""C:\Program Files\App\app.exe,-101""#),
            Some((PathBuf::from(r"C:\Program Files\App\app.exe"), -101))
        );
        assert_eq!(
            parse_display_icon_spec(r"D:\Games\icon.ico"),
            Some((PathBuf::from(r"D:\Games\icon.ico"), 0))
        );
    }
}
