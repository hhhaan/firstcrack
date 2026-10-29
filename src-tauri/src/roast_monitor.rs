use std::sync::Mutex;
use tauri::{AppHandle, Manager, WindowEvent};

#[derive(Default)]
pub struct RoastMonitorState(Mutex<bool>);

enum Action {
    Sync(bool),
    Refresh,
    Main { focus: bool },
}

fn should_show_monitor(enabled: bool, main_minimized: bool) -> bool {
    enabled && main_minimized
}

fn is_transient_webview_error(error: &str) -> bool {
    error.contains("8007139F")
        || error.contains("ERROR_INVALID_STATE")
        || error.contains("failed to create webview")
}

fn restore_main(main: &tauri::WebviewWindow, focus: bool) -> tauri::Result<()> {
    main.show()?;
    main.unminimize()?;
    if focus {
        main.set_focus()?;
    }
    Ok(())
}

fn monitor_config(app: &AppHandle) -> Result<tauri::utils::config::WindowConfig, String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "roast-monitor")
        .cloned()
        .ok_or_else(|| "Roast monitor configuration is missing".to_string())
}

fn ensure_monitor_window(app: &AppHandle) -> Result<Option<tauri::WebviewWindow>, String> {
    if let Some(window) = app.get_webview_window("roast-monitor") {
        return Ok(Some(window));
    }
    let config = monitor_config(app)?;
    match crate::browser_defaults::create_window(app, &config) {
        Ok(()) => Ok(app.get_webview_window("roast-monitor")),
        Err(error) => {
            let message = error.to_string();
            if is_transient_webview_error(&message) {
                eprintln!("[roast-monitor] Webview creation deferred: {message}");
                Ok(None)
            } else {
                Err(message)
            }
        }
    }
}

fn apply_on_main_thread(app: &AppHandle, action: Action) -> Result<(), String> {
    let controller = app.state::<RoastMonitorState>();
    let mut enabled = controller.0.lock().map_err(|error| error.to_string())?;
    if let Action::Sync(next) = action {
        *enabled = next;
    }
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };
    let monitor = app.get_webview_window("roast-monitor");
    let monitor_visible = monitor
        .as_ref()
        .map(|window| window.is_visible())
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);
    let returning = matches!(action, Action::Main { .. });
    let main_minimized = main.is_minimized().map_err(|error| error.to_string())?;
    let show_monitor = !returning && should_show_monitor(*enabled, main_minimized);

    if *enabled && monitor.is_none() {
        let _ = ensure_monitor_window(app)?;
    }

    if show_monitor {
        let monitor = if let Some(window) = app.get_webview_window("roast-monitor") {
            window
        } else {
            match ensure_monitor_window(app)? {
                Some(window) => window,
                None => return Ok(()),
            }
        };
        if !should_show_monitor(
            *enabled,
            main.is_minimized().map_err(|error| error.to_string())?,
        ) {
            return Ok(());
        }
        if !monitor_visible {
            if let Err(error) = monitor.show() {
                if monitor.hide().is_ok() {
                    let _ = restore_main(&main, false);
                }
                return Err(error.to_string());
            }
        }
    } else if monitor_visible || returning {
        if let Some(monitor) = &monitor {
            monitor.hide().map_err(|error| error.to_string())?;
        }
        let focus = matches!(action, Action::Main { focus: true });
        if let Err(error) = restore_main(&main, focus) {
            if monitor_visible {
                if let Some(monitor) = monitor {
                    let _ = monitor.show();
                }
            }
            return Err(error.to_string());
        }
    }
    Ok(())
}

async fn run_on_ui_thread(app: AppHandle, action: Action) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let app_for_thread = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(apply_on_main_thread(&app_for_thread, action));
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

async fn apply(app: AppHandle, action: Action) -> Result<(), String> {
    static APPLY: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));
    let _guard = APPLY.lock().await;
    run_on_ui_thread(app, action).await
}

#[tauri::command]
pub async fn sync_roast_monitor(app: AppHandle, enabled: bool) -> Result<(), String> {
    apply(app, Action::Sync(enabled)).await
}

#[tauri::command]
pub async fn show_roast_main(app: AppHandle) -> Result<(), String> {
    apply(app, Action::Main { focus: true }).await
}

fn dispatch(app: AppHandle, action: Action) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = apply(app, action).await {
            eprintln!("[roast-monitor] Could not switch windows: {error}");
        }
    });
}

pub fn focus_main(app: &AppHandle) {
    dispatch(app.clone(), Action::Main { focus: true });
}

#[cfg(target_os = "macos")]
pub fn request_main_close(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = apply(app.clone(), Action::Main { focus: true }).await {
            eprintln!("[roast-monitor] Could not restore the close confirmation window: {error}");
            return;
        }
        if let Some(main) = app.get_webview_window("main") {
            if let Err(error) = main.close() {
                eprintln!("[close] Could not request main window close: {error}");
            }
        } else {
            app.exit(0);
        }
    });
}

pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    match (window.label(), event) {
        ("main", WindowEvent::Focused(_) | WindowEvent::Resized(_)) => {
            dispatch(window.app_handle().clone(), Action::Refresh)
        }
        ("roast-monitor", WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            focus_main(window.app_handle());
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_monitor_only_while_main_is_minimized() {
        assert!(!should_show_monitor(true, false));
        assert!(should_show_monitor(true, true));
    }

    #[test]
    fn disabled_monitor_stays_hidden_even_when_main_is_minimized() {
        assert!(!should_show_monitor(false, false));
        assert!(!should_show_monitor(false, true));
    }

    #[test]
    fn recognizes_transient_webview_creation_failures() {
        assert!(is_transient_webview_error(
            "runtime error: failed to create webview: WebView2 error: WindowsError(Error { code: HRESULT(0x8007139F)"
        ));
        assert!(!is_transient_webview_error("Roast monitor configuration is missing"));
    }
}
