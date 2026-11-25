use serde::Serialize;

/// Color de énfasis por defecto estilo Windows 11 Fluent Blue si no se puede leer del Registro.
pub const DEFAULT_WINDOWS_ACCENT_HEX: &str = "#0067C0";

/// Información del tema visual y color de énfasis reales configurados en Windows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsThemeInfo {
    pub accent_hex: String,
    pub system_prefers_dark: bool,
    pub accent_on_titlebar: bool,
}

impl Default for WindowsThemeInfo {
    fn default() -> Self {
        Self {
            accent_hex: DEFAULT_WINDOWS_ACCENT_HEX.to_string(),
            system_prefers_dark: false,
            accent_on_titlebar: false,
        }
    }
}

/// Convierte un DWORD `AccentColor` del Registro de Windows (`0xAABBGGRR`, orden ABGR)
/// en una cadena hexadecimal `#RRGGBB`.
pub fn parse_abgr_accent_color(abgr: u32) -> String {
    let r = abgr & 0xFF;
    let g = (abgr >> 8) & 0xFF;
    let b = (abgr >> 16) & 0xFF;
    format!("#{r:02X}{g:02X}{b:02X}")
}

/// Convierte un DWORD `ColorizationColor` del Registro de Windows (`0xAARRGGBB`, orden ARGB)
/// en una cadena hexadecimal `#RRGGBB`.
pub fn parse_argb_colorization_color(argb: u32) -> String {
    let r = (argb >> 16) & 0xFF;
    let g = (argb >> 8) & 0xFF;
    let b = argb & 0xFF;
    format!("#{r:02X}{g:02X}{b:02X}")
}

/// Lee el tema actual (Claro / Oscuro) y el color de énfasis real de Windows desde HKCU.
#[cfg(windows)]
pub fn read_windows_theme_info() -> WindowsThemeInfo {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let system_prefers_dark = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
        .ok()
        .and_then(|key| key.get_value::<u32, _>("AppsUseLightTheme").ok())
        .map(|val| val == 0)
        .unwrap_or(false);

    let dwm_key = hkcu.open_subkey("Software\\Microsoft\\Windows\\DWM").ok();

    let accent_hex = dwm_key
        .as_ref()
        .and_then(|key| {
            key.get_value::<u32, _>("AccentColor")
                .ok()
                .map(parse_abgr_accent_color)
                .or_else(|| {
                    key.get_value::<u32, _>("ColorizationColor")
                        .ok()
                        .map(parse_argb_colorization_color)
                })
        })
        .unwrap_or_else(|| DEFAULT_WINDOWS_ACCENT_HEX.to_string());

    let accent_on_titlebar = dwm_key
        .as_ref()
        .and_then(|key| key.get_value::<u32, _>("ColorPrevalence").ok())
        .map(|val| val != 0)
        .unwrap_or(false);

    WindowsThemeInfo {
        accent_hex,
        system_prefers_dark,
        accent_on_titlebar,
    }
}

/// Fallback en entornos no-Windows (tests/compilación cruzada).
#[cfg(not(windows))]
pub fn read_windows_theme_info() -> WindowsThemeInfo {
    WindowsThemeInfo::default()
}

/// Traduce el modo guardado ("dark", "light", "system") al `Option<tauri::Theme>`
/// para sincronizar la barra de título nativa de la ventana en Windows 10/11.
pub fn resolve_tauri_window_theme(mode: &str) -> Option<tauri::Theme> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        _ => None, // None = seguir automáticamente el tema nativo de Windows
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_windows_abgr_accent_to_hex_rgb() {
        // Windows Fluent Blue (#0067C0) en formato ABGR: A=FF, B=C0, G=67, R=00 -> 0xFFC06700
        assert_eq!(parse_abgr_accent_color(0xFFC06700), "#0067C0");
        // Windows Purple (#744DA9) en formato ABGR: A=FF, B=A9, G=4D, R=74 -> 0xFFA94D74
        assert_eq!(parse_abgr_accent_color(0xFFA94D74), "#744DA9");
    }

    #[test]
    fn converts_windows_argb_colorization_to_hex_rgb() {
        assert_eq!(parse_argb_colorization_color(0xC40078D7), "#0078D7");
    }

    #[test]
    fn maps_theme_modes_to_tauri_theme() {
        assert_eq!(resolve_tauri_window_theme("dark"), Some(tauri::Theme::Dark));
        assert_eq!(
            resolve_tauri_window_theme("light"),
            Some(tauri::Theme::Light)
        );
        assert_eq!(resolve_tauri_window_theme("system"), None);
    }
}
