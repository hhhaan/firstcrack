// COLORREF stores 0x00BBGGRR. Keep these in sync with App.css's light theme.
const CAPTION_COLOR: u32 = 0x00f6f4f3;
const TEXT_COLOR: u32 = 0x00281810;

/// Mac main window in `tauri.conf.json`. Windows uses the same logical size.
pub const MAC_WINDOW_WIDTH: f64 = 1260.0;
pub const MAC_WINDOW_HEIGHT: f64 = 810.0;
const WORK_AREA_MARGIN: f64 = 0.95;

/// Scale that fits the Mac window into the work area without changing its 1260:810 ratio.
/// 1 when the display already fits that window. Never enlarges, and never goes below half.
pub fn mac_fit(scale: f64, work_width_px: f64, work_height_px: f64) -> f64 {
    if !scale.is_finite()
        || scale <= 0.0
        || !work_width_px.is_finite()
        || work_width_px <= 0.0
        || !work_height_px.is_finite()
        || work_height_px <= 0.0
    {
        return 1.0;
    }
    let max_w = work_width_px / scale * WORK_AREA_MARGIN;
    let max_h = work_height_px / scale * WORK_AREA_MARGIN;
    (max_w / MAC_WINDOW_WIDTH)
        .min(max_h / MAC_WINDOW_HEIGHT)
        .clamp(0.5, 1.0)
}

#[cfg(target_os = "windows")]
pub fn apply_mac_layout(window: &tauri::WebviewWindow) {
    use tauri::{LogicalSize, Size};

    let fit = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let work = monitor.work_area().size;
            mac_fit(monitor.scale_factor(), work.width as f64, work.height as f64)
        })
        .unwrap_or(1.0);
    let width = MAC_WINDOW_WIDTH * fit;
    let height = MAC_WINDOW_HEIGHT * fit;
    // tauri.conf.json min is 1024×680. A shorter display has to go below that or the ratio breaks.
    if width < 1024.0 || height < 680.0 {
        let _ = window.set_min_size(Some(Size::Logical(LogicalSize::new(width, height))));
    }
    let _ = window.set_size(Size::Logical(LogicalSize::new(width, height)));
    let _ = window.center();
    if let Err(error) = window.set_zoom(fit) {
        eprintln!("[window] Could not set content zoom: {error}");
    }
}

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
    use super::{mac_fit, CAPTION_COLOR, MAC_WINDOW_HEIGHT, MAC_WINDOW_WIDTH, TEXT_COLOR};

    #[test]
    fn mac_window_size_matches_tauri_conf() {
        let conf = include_str!("../tauri.conf.json");
        assert!(conf.contains(&format!("\"width\": {}", MAC_WINDOW_WIDTH as u32)));
        assert!(conf.contains(&format!("\"height\": {}", MAC_WINDOW_HEIGHT as u32)));
    }

    #[test]
    fn mac_fit_keeps_the_mac_window_when_the_display_is_large_enough() {
        assert_eq!(mac_fit(1.0, 1920.0, 1080.0), 1.0);
        assert_eq!(mac_fit(2.0, 3840.0, 2160.0), 1.0);
    }

    #[test]
    fn mac_fit_shrinks_a_200_percent_1080p_display_without_changing_the_ratio() {
        let fit = mac_fit(2.0, 1920.0, 1080.0);
        let logical_h = 1080.0 / 2.0 * 0.95;
        assert!((fit - logical_h / MAC_WINDOW_HEIGHT).abs() < 1e-9);
        assert!(logical_h / MAC_WINDOW_HEIGHT < (1920.0 / 2.0 * 0.95) / MAC_WINDOW_WIDTH);
    }

    #[test]
    fn mac_fit_floors_at_half_and_ignores_bad_input() {
        assert_eq!(mac_fit(2.0, 800.0, 600.0), 0.5);
        assert_eq!(mac_fit(0.0, 1920.0, 1080.0), 1.0);
        assert_eq!(mac_fit(1.0, f64::NAN, 1080.0), 1.0);
    }

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
