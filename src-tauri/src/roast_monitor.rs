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

fn restore_main(main: &tauri::WebviewWindow, focus: bool) -> tauri::Result<()> {
    main.show()?;
    main.unminimize()?;
    if focus {
        main.set_focus()?;
    }
    Ok(())
}

async fn apply(app: AppHandle, action: Action) -> Result<(), String> {
    // Window creation must run off the UI thread, including on Windows.
    tauri::async_runtime::spawn_blocking(move || {
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
        let show_monitor = !returning
            && should_show_monitor(
                *enabled,
                main.is_minimized().map_err(|error| error.to_string())?,
            );
        if show_monitor {
            let monitor = if let Some(window) = monitor {
                window
            } else {
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|config| config.label == "roast-monitor")
                    .ok_or("Roast monitor configuration is missing")?;
                crate::browser_defaults::create_window(&app, config)
                    .map_err(|error| error.to_string())?;
                app.get_webview_window("roast-monitor")
                    .ok_or("Roast monitor was not created")?
            };
            // The main window may have been restored while the webview was being created.
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
    })
    .await
    .map_err(|error| error.to_string())?
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
}
