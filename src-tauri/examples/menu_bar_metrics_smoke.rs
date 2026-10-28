//! Run on macOS to exercise the actual AppKit status item without a roaster connection.
#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/menu_bar_metrics.rs"]
mod metrics;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let mtm = MainThreadMarker::new().expect("main thread");
    let _app = NSApplication::sharedApplication(mtm);
    for (et, ror, time) in [("241.8°C", "-0.7", "28:55"), ("—", "-1234.5", "1000:00")] {
        let reading = serde_json::from_value(serde_json::json!({
            "et": et, "bt": "208.2°C", "ror": ror, "time": time
        }))
        .expect("valid native reading");
        metrics::native::update(Some(reading)).expect("native item update");
    }
    metrics::native::update(None).expect("native item removal");
    metrics::native::update(None).expect("repeated removal");
    assert!(std::thread::spawn(|| metrics::native::update(None))
        .join()
        .unwrap()
        .is_err());
    println!("Native menu bar create/update/remove and main-thread guard passed");
}

#[cfg(not(target_os = "macos"))]
fn main() {}
