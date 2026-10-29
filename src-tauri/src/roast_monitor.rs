use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WindowEvent};

const MAX_TRANSIENT_CREATE_ATTEMPTS: u32 = 5;
const CREATE_BACKOFF_CAP: Duration = Duration::from_secs(30);

#[derive(Default)]
struct CreationBackoff {
    transient_failures: u32,
    next_attempt: Option<Instant>,
}

#[derive(Default)]
pub struct RoastMonitorState {
    enabled: Mutex<bool>,
    creation: Mutex<CreationBackoff>,
}

enum Action {
    Sync(bool),
    Refresh,
    Main { focus: bool },
}

fn should_show_monitor(enabled: bool, main_minimized: bool) -> bool {
    enabled && main_minimized
}

fn is_transient_webview_hresult(error: &str) -> bool {
    let upper = error.to_ascii_uppercase();
    upper.contains("8007139F") || upper.contains("ERROR_INVALID_STATE")
}

fn creation_backoff_after_failure(state: &mut CreationBackoff, transient: bool) -> Option<Duration> {
    if !transient {
        state.transient_failures = 0;
        state.next_attempt = None;
        return None;
    }
    state.transient_failures = state.transient_failures.saturating_add(1);
    let shift = state.transient_failures.saturating_sub(1).min(6);
    let millis = 500_u64.saturating_mul(1_u64 << shift);
    let delay = Duration::from_millis(millis).min(CREATE_BACKOFF_CAP);
    state.next_attempt = Some(Instant::now() + delay);
    Some(delay)
}

fn creation_backoff_cooldown(state: &CreationBackoff) -> Option<Duration> {
    state
        .next_attempt
        .and_then(|deadline| deadline.checked_duration_since(Instant::now()))
        .filter(|remaining| !remaining.is_zero())
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

fn ensure_monitor_window(
    app: &AppHandle,
    creation: &mut CreationBackoff,
) -> Result<Option<tauri::WebviewWindow>, String> {
    if let Some(window) = app.get_webview_window("roast-monitor") {
        creation.transient_failures = 0;
        creation.next_attempt = None;
        return Ok(Some(window));
    }
    if let Some(remaining) = creation_backoff_cooldown(creation) {
        eprintln!(
            "[roast-monitor] Webview creation backing off for {}ms",
            remaining.as_millis()
        );
        return Ok(None);
    }
    let config = monitor_config(app)?;
    match crate::browser_defaults::create_window(app, &config) {
        Ok(()) => {
            creation.transient_failures = 0;
            creation.next_attempt = None;
            Ok(app.get_webview_window("roast-monitor"))
        }
        Err(error) => {
            let message = error.to_string();
            let transient = is_transient_webview_hresult(&message);
            if transient && creation.transient_failures + 1 >= MAX_TRANSIENT_CREATE_ATTEMPTS {
                return Err(message);
            }
            if let Some(delay) = creation_backoff_after_failure(creation, transient) {
                eprintln!(
                    "[roast-monitor] Webview creation deferred ({}ms): {message}",
                    delay.as_millis()
                );
                Ok(None)
            } else {
                Err(message)
            }
        }
    }
}

fn destroy_monitor_if_present(app: &AppHandle) {
    if let Some(monitor) = app.get_webview_window("roast-monitor") {
        let _ = monitor.destroy();
    }
}

fn apply_inner(app: &AppHandle, action: Action) -> Result<(), String> {
    let state = app.state::<RoastMonitorState>();
    let mut enabled = state.enabled.lock().map_err(|error| error.to_string())?;
    let mut creation = state.creation.lock().map_err(|error| error.to_string())?;
    if let Action::Sync(next) = action {
        if !next {
            destroy_monitor_if_present(app);
            creation.transient_failures = 0;
            creation.next_attempt = None;
        }
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

    if show_monitor {
        let monitor = if let Some(window) = monitor {
            window
        } else {
            match ensure_monitor_window(app, &mut creation)? {
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

async fn apply(app: AppHandle, action: Action) -> Result<(), String> {
    static APPLY: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));
    let _guard = APPLY.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| apply_inner(&app, action))) {
            Ok(result) => result,
            Err(_) => Err("Roast monitor window logic panicked".to_string()),
        }
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

    #[test]
    fn transient_hresult_matches_only_known_webview2_state_errors() {
        assert!(is_transient_webview_hresult(
            "runtime error: failed to create webview: WebView2 error: WindowsError(Error { code: HRESULT(0x8007139F)"
        ));
        assert!(is_transient_webview_hresult("ERROR_INVALID_STATE in environment"));
        assert!(!is_transient_webview_hresult(
            "runtime error: failed to create webview: WebView2 error: other"
        ));
        assert!(!is_transient_webview_hresult("Roast monitor configuration is missing"));
    }

    #[test]
    fn creation_backoff_waits_then_allows_retry() {
        let mut state = CreationBackoff::default();
        let delay = creation_backoff_after_failure(&mut state, true).unwrap();
        assert_eq!(state.transient_failures, 1);
        assert!(creation_backoff_cooldown(&state).unwrap() <= delay);

        state.next_attempt = Some(Instant::now() - Duration::from_millis(1));
        assert!(creation_backoff_cooldown(&state).is_none());

        creation_backoff_after_failure(&mut state, false);
        assert_eq!(state.transient_failures, 0);
        assert!(state.next_attempt.is_none());
    }

    #[test]
    fn permanent_create_errors_clear_transient_backoff() {
        let mut state = CreationBackoff {
            transient_failures: 2,
            next_attempt: Some(Instant::now() + Duration::from_secs(5)),
        };
        assert!(creation_backoff_after_failure(&mut state, false).is_none());
        assert_eq!(state.transient_failures, 0);
        assert!(state.next_attempt.is_none());
    }
}
