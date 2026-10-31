//! WebView2 on Windows requires every webview that shares a user-data folder to use
//! identical browser arguments. Main sets `additionalBrowserArgs` in tauri.conf.json;
//! dynamically created windows must apply the same string via the builder.

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const WINDOWS_ADDITIONAL_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

/// Browser args applied when lazily creating the roast-monitor webview on Windows.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn roast_monitor_additional_browser_args() -> &'static str {
    WINDOWS_ADDITIONAL_BROWSER_ARGS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn main_window_additional_browser_args_from_config() -> Option<String> {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).ok()?;
        config["app"]["windows"]
            .as_array()?
            .iter()
            .find(|window| window["label"] == "main")?
            .get("additionalBrowserArgs")?
            .as_str()
            .map(str::to_owned)
    }

    #[test]
    fn roast_monitor_browser_args_match_main_window_config() {
        let main_args = main_window_additional_browser_args_from_config()
            .expect("main window additionalBrowserArgs in tauri.conf.json");
        assert_eq!(main_args, WINDOWS_ADDITIONAL_BROWSER_ARGS);
        assert_eq!(
            roast_monitor_additional_browser_args(),
            WINDOWS_ADDITIONAL_BROWSER_ARGS
        );
    }
}
