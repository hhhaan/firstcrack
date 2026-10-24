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
        GetKeyState, VK_BROWSER_REFRESH, VK_CONTROL, VK_F5, VK_MENU,
    };

    controller
        .CoreWebView2()?
        .Settings()?
        .SetAreDefaultContextMenusEnabled(false)?;

    // WebView2 can handle print/reload before DOM keydown, so block native accelerators too.
    let handler = AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
        if let Some(args) = args {
            let mut key = 0;
            args.VirtualKey(&mut key)?;
            if key == u32::from(VK_F5.0)
                || key == u32::from(VK_BROWSER_REFRESH.0)
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
