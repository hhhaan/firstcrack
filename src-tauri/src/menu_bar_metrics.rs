#[derive(serde::Deserialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct MenuBarReading {
    et: String,
    bt: String,
    ror: String,
    time: String,
}

#[tauri::command]
pub async fn update_menu_bar_metrics(
    app: tauri::AppHandle,
    reading: Option<MenuBarReading>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let result = native::update(reading);
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
        receive.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, reading);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub(crate) mod native {
    use super::MenuBarReading;
    use objc2::{rc::Retained, MainThreadMarker};
    use objc2_app_kit::{
        NSColor, NSFont, NSFontWeightLight, NSFontWeightRegular, NSStatusBar, NSStatusItem,
        NSTextField,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    use std::cell::RefCell;

    const WIDTHS: [f64; 4] = [56.0, 56.0, 30.0, 36.0];
    const GAP: f64 = 12.0;
    const PAD: f64 = 2.0;

    struct Metrics {
        item: Retained<NSStatusItem>,
        values: Vec<Retained<NSTextField>>,
    }

    impl Drop for Metrics {
        fn drop(&mut self) {
            NSStatusBar::systemStatusBar().removeStatusItem(&self.item);
        }
    }

    thread_local! {
        static METRICS: RefCell<Option<Metrics>> = const { RefCell::new(None) };
    }

    fn create(mtm: MainThreadMarker) -> Result<Metrics, String> {
        let width = WIDTHS.iter().sum::<f64>() + GAP * 3.0 + PAD * 2.0;
        let item = NSStatusBar::systemStatusBar().statusItemWithLength(width);
        let Some(button) = item.button(mtm) else {
            NSStatusBar::systemStatusBar().removeStatusItem(&item);
            return Err("macOS status item has no button".into());
        };
        let offset = (button.frame().size.height - 22.0) / 2.0;
        // Status bar buttons can use top-down coordinates, unlike a default NSView.
        let (label_y, value_y) = if button.isFlipped() {
            (offset, offset + 7.0)
        } else {
            (offset + 14.0, offset)
        };
        let mut values = Vec::new();
        let mut x = PAD;
        for (title, width) in ["ET", "BT", "RoR", "Time"].into_iter().zip(WIDTHS) {
            let label = NSTextField::labelWithString(&NSString::from_str(title), mtm);
            label.setFont(Some(&NSFont::systemFontOfSize_weight(7.0, unsafe {
                NSFontWeightLight
            })));
            label.setTextColor(Some(&NSColor::labelColor()));
            label.setFrame(NSRect::new(
                NSPoint::new(x, label_y),
                NSSize::new(width, 8.0),
            ));
            button.addSubview(&label);

            let value = NSTextField::labelWithString(&NSString::from_str(""), mtm);
            value.setFont(Some(&NSFont::systemFontOfSize_weight(12.0, unsafe {
                NSFontWeightRegular
            })));
            value.setTextColor(Some(&NSColor::labelColor()));
            value.setFrame(NSRect::new(
                NSPoint::new(x, value_y),
                NSSize::new(width, 15.0),
            ));
            button.addSubview(&value);
            values.push(value);
            x += width + GAP;
        }
        Ok(Metrics { item, values })
    }

    pub(crate) fn update(reading: Option<MenuBarReading>) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("Menu bar update requires the main thread")?;
        METRICS.with(|state| {
            let mut state = state.borrow_mut();
            let Some(reading) = reading else {
                state.take();
                return Ok(());
            };
            if state.is_none() {
                *state = Some(create(mtm)?);
            }
            if let Some(metrics) = state.as_ref() {
                for ((field, text), width) in metrics
                    .values
                    .iter()
                    .zip([reading.et, reading.bt, reading.ror, reading.time])
                    .zip(WIDTHS)
                {
                    field.setFont(Some(&NSFont::systemFontOfSize_weight(12.0, unsafe {
                        NSFontWeightRegular
                    })));
                    field.setStringValue(&NSString::from_str(&text));
                    let natural_width = field.intrinsicContentSize().width;
                    if natural_width > width {
                        field.setFont(Some(&NSFont::systemFontOfSize_weight(
                            12.0 * width / natural_width,
                            unsafe { NSFontWeightRegular },
                        )));
                    }
                }
            }
            Ok(())
        })
    }
}
