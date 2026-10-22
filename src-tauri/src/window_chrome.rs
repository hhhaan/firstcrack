// COLORREF stores 0x00BBGGRR. Keep these in sync with App.css's light theme.
const CAPTION_COLOR: u32 = 0x00f6f4f3;
const TEXT_COLOR: u32 = 0x00281810;

#[cfg(target_os = "windows")]
pub fn match_shell(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }

    // The app currently uses a light theme; keep native caption buttons readable too.
    if let Err(error) = window.set_theme(Some(tauri::Theme::Light)) {
        eprintln!("[window] Could not set the native light theme: {error}");
    }
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd,
        Err(error) => {
            eprintln!("[window] Could not get the native window handle: {error}");
            return;
        }
    };

    for (attribute, color) in [
        (DWMWA_CAPTION_COLOR, CAPTION_COLOR),
        (DWMWA_TEXT_COLOR, TEXT_COLOR),
    ] {
        // SAFETY: Tauri owns a live HWND; color is a COLORREF valid for the synchronous call.
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd.0,
                attribute,
                (&color as *const u32).cast(),
                std::mem::size_of::<u32>() as u32,
            )
        };
        // Windows 10 does not support these attributes; retain its native light caption.
        if result < 0 {
            eprintln!("[window] Native caption attribute {attribute} unavailable: {result:#x}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{CAPTION_COLOR, TEXT_COLOR};

    #[test]
    fn native_caption_colors_match_the_light_theme() {
        let css = include_str!("../../src/App.css");
        for (property, color) in [
            ("--color-shell-bg", CAPTION_COLOR),
            ("--color-primary", TEXT_COLOR),
        ] {
            let [red, green, blue, _] = color.to_le_bytes();
            let declaration = format!("{property}: #{red:02x}{green:02x}{blue:02x};");
            assert!(
                css.contains(&declaration),
                "Native caption is out of sync: {declaration}"
            );
        }
    }
}
