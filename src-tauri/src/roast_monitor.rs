use std::sync::Mutex;
use tauri::{AppHandle, Manager, WindowEvent};

#[derive(Default)]
pub struct RoastMonitorState(Mutex<bool>);

enum Action {
    Sync(bool),
    Refresh,
    Main { focus: bool },
}

struct MainVisibility {
    focused: bool,
    visible: bool,
    minimized: bool,
    app_active: bool,
}

fn should_show_monitor(enabled: bool, main: &MainVisibility, monitor_visible: bool) -> bool {
    enabled
        && !main.focused
        && (monitor_visible || !main.visible || main.minimized || !main.app_active)
}

#[cfg(target_os = "macos")]
fn app_active(app: &AppHandle) -> Result<bool, String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        // SAFETY: AppKit is initialized by Tauri; NSApplication is read on its main thread.
        let active: bool = unsafe {
            let application: *mut objc2::runtime::AnyObject =
                objc2::msg_send![objc2::class!(NSApplication), sharedApplication];
            objc2::msg_send![application, isActive]
        };
        let _ = send.send(active);
    })
    .map_err(|error| error.to_string())?;
    receive
        .recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn app_active(_app: &AppHandle) -> Result<bool, String> {
    use std::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowThreadProcessId(window: *mut c_void, process_id: *mut u32) -> u32;
    }
    let mut process_id = 0;
    // SAFETY: Windows owns the foreground HWND; process_id is writable for this call.
    unsafe {
        GetWindowThreadProcessId(GetForegroundWindow(), &mut process_id);
    }
    Ok(process_id == std::process::id())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn app_active(app: &AppHandle) -> Result<bool, String> {
    Ok(app
        .webview_windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(false)))
}

fn visibility(app: &AppHandle, main: &tauri::WebviewWindow) -> Result<MainVisibility, String> {
    Ok(MainVisibility {
        focused: main.is_focused().map_err(|error| error.to_string())?,
        visible: main.is_visible().map_err(|error| error.to_string())?,
        minimized: main.is_minimized().map_err(|error| error.to_string())?,
        app_active: app_active(app)?,
    })
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
        let show_monitor =
            !returning && should_show_monitor(*enabled, &visibility(&app, &main)?, monitor_visible);
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
            // Focus may have returned while the webview was being created.
            if !should_show_monitor(*enabled, &visibility(&app, &main)?, monitor_visible) {
                return Ok(());
            }
            if main.is_visible().map_err(|error| error.to_string())? {
                main.hide().map_err(|error| error.to_string())?;
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
                if monitor_visible && main.hide().is_ok() {
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
        ("main", WindowEvent::Focused(_)) => dispatch(window.app_handle().clone(), Action::Refresh),
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

    fn main() -> MainVisibility {
        MainVisibility {
            focused: true,
            visible: true,
            minimized: false,
            app_active: true,
        }
    }

    #[test]
    fn switches_to_monitor_on_background_minimize_or_hide_only_when_enabled() {
        for hidden in [
            MainVisibility {
                focused: false,
                app_active: false,
                ..main()
            },
            MainVisibility {
                focused: false,
                minimized: true,
                ..main()
            },
            MainVisibility {
                focused: false,
                visible: false,
                ..main()
            },
        ] {
            assert!(should_show_monitor(true, &hidden, false));
            assert!(!should_show_monitor(false, &hidden, false));
        }
    }

    #[test]
    fn main_focus_takes_priority_and_monitor_focus_does_not_restore_main() {
        assert!(!should_show_monitor(true, &main(), true));
        assert!(should_show_monitor(
            true,
            &MainVisibility {
                focused: false,
                ..main()
            },
            true
        ));
    }

    #[test]
    fn native_dialog_does_not_hide_its_main_window() {
        assert!(!should_show_monitor(
            true,
            &MainVisibility {
                focused: false,
                ..main()
            },
            false
        ));
    }
}
