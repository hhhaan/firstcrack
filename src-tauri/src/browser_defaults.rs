use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::Url;
use tauri_plugin_opener::OpenerExt;

fn same_origin(url: &Url, app_origin: &Url) -> bool {
    url.scheme() == app_origin.scheme()
        && url.host_str() == app_origin.host_str()
        && url.port_or_known_default() == app_origin.port_or_known_default()
}

fn allows_startup_navigation(url: &Url, app_origin: &Url, loaded: bool) -> bool {
    !loaded
        && same_origin(url, app_origin)
        && (url.path() == app_origin.path()
            || (matches!(url.path(), "" | "/") && matches!(app_origin.path(), "" | "/"))
            || url.path() == "/index.html")
}

fn open_external<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &Url, app_origin: &Url) {
    if matches!(url.scheme(), "http" | "https") && !same_origin(url, app_origin) {
        if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
            eprintln!("[browser-defaults] Could not open external link: {error}");
        }
    }
}

pub fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let config = &app.config().app.windows[0];
    let bundled_origin = if cfg!(target_os = "windows") {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    let app_origin = if cfg!(dev) {
        app.config().build.dev_url.clone()
    } else {
        None
    }
    .unwrap_or_else(|| Url::parse(bundled_origin).expect("valid bundled app origin"));
    let navigation_origin = app_origin.clone();
    let page_origin = app_origin.clone();
    let navigation_app = app.handle().clone();
    let new_window_app = app.handle().clone();
    let loaded = Arc::new(AtomicBool::new(false));
    let navigation_loaded = loaded.clone();

    tauri::WebviewWindowBuilder::from_config(app, config)?
        .devtools(cfg!(debug_assertions))
        .on_download(|_, _| true)
        .on_navigation(move |url| {
            // Only the configured startup document may load; SPA view changes do not navigate.
            if allows_startup_navigation(
                url,
                &navigation_origin,
                navigation_loaded.load(Ordering::SeqCst),
            ) {
                return true;
            }
            open_external(&navigation_app, url, &navigation_origin);
            false
        })
        .on_page_load(move |_, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished
                && allows_startup_navigation(payload.url(), &page_origin, false)
            {
                loaded.store(true, Ordering::SeqCst);
            }
        })
        .on_new_window(move |url, _| {
            open_external(&new_window_app, &url, &app_origin);
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new("browser-defaults")
        .js_init_script(include_str!("browser_defaults.js"));

    #[cfg(target_os = "windows")]
    let builder = builder.on_webview_ready(|webview| {
        if let Err(error) = webview.with_webview(|platform| {
            // SAFETY: with_webview runs on the UI thread that owns these COM interfaces.
            if let Err(error) = unsafe { configure_windows(platform.controller()) } {
                eprintln!("[browser-defaults] Could not block native browser actions: {error}");
            }
        }) {
            eprintln!("[browser-defaults] Could not access the native webview: {error}");
        }
    });

    builder.build()
}

#[cfg(target_os = "windows")]
unsafe fn configure_windows(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> windows::core::Result<()> {
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2AcceleratorKeyPressedEventArgs2;
    use windows::core::Interface;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_BROWSER_BACK, VK_BROWSER_FORWARD, VK_BROWSER_REFRESH, VK_CONTROL, VK_F12,
        VK_F5, VK_LEFT, VK_MENU, VK_RIGHT, VK_SHIFT,
    };

    controller
        .CoreWebView2()?
        .Settings()?
        .SetAreDefaultContextMenusEnabled(false)?;
    controller
        .CoreWebView2()?
        .Settings()?
        .SetAreDevToolsEnabled(cfg!(debug_assertions))?;

    // WebView2 can handle print/reload before DOM keydown, so block native accelerators too.
    let handler = AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
        if let Some(args) = args {
            let mut key = 0;
            args.VirtualKey(&mut key)?;
            if key == u32::from(VK_F5.0)
                || key == u32::from(VK_BROWSER_REFRESH.0)
                || key == u32::from(VK_BROWSER_BACK.0)
                || key == u32::from(VK_BROWSER_FORWARD.0)
                || key == u32::from(VK_F12.0)
                || ((key == u32::from(VK_LEFT.0) || key == u32::from(VK_RIGHT.0))
                    && GetKeyState(i32::from(VK_MENU.0)) < 0)
                || ((key == u32::from(b'I') || key == u32::from(b'J') || key == u32::from(b'C'))
                    && GetKeyState(i32::from(VK_CONTROL.0)) < 0
                    && GetKeyState(i32::from(VK_SHIFT.0)) < 0)
                || ((key == u32::from(b'P') || key == u32::from(b'R'))
                    && GetKeyState(i32::from(VK_CONTROL.0)) < 0
                    && GetKeyState(i32::from(VK_MENU.0)) >= 0)
            {
                if let Ok(browser_key) = args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>()
                {
                    // Keep app bindings while suppressing the browser action.
                    browser_key.SetIsBrowserAcceleratorKeyEnabled(false)?;
                } else {
                    args.SetHandled(true)?;
                }
            }
        }
        Ok(())
    }));
    let mut token = 0;
    controller.add_AcceleratorKeyPressed(&handler, &mut token)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treats_empty_and_root_bundled_paths_as_the_same_startup_document() {
        let empty = Url::parse("tauri://localhost").unwrap();
        let root = Url::parse("tauri://localhost/").unwrap();
        assert!(allows_startup_navigation(&empty, &root, false));
        assert!(allows_startup_navigation(&root, &empty, false));
        assert!(!allows_startup_navigation(&empty, &root, true));
        assert!(!allows_startup_navigation(&root, &empty, true));
    }

    #[test]
    fn permits_only_the_initial_app_document() {
        for origin in [
            "tauri://localhost/",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
            "http://localhost:1420/",
        ] {
            let origin = Url::parse(origin).unwrap();
            assert!(allows_startup_navigation(&origin, &origin, false));
            assert!(allows_startup_navigation(
                &origin.join("index.html").unwrap(),
                &origin,
                false
            ));
            assert!(!allows_startup_navigation(&origin, &origin, true));
            for other in [
                "about:blank",
                "https://example.com/",
                "file:///tmp/profile.html",
                "http://localhost:9999/",
                "http://localhost:1437/",
            ] {
                assert!(!allows_startup_navigation(
                    &Url::parse(other).unwrap(),
                    &origin,
                    false
                ));
            }
            assert!(!allows_startup_navigation(
                &origin.join("other.html").unwrap(),
                &origin,
                false
            ));
        }
    }
}
