//! 온도 폴링 페이서. webview `setInterval`은 숨김 시 1s 정렬된다 (#308).
//! 호스트 500ms tick → `sidecar-poll-tick`. 프론트가 pollIntervalMs로 게이트.

use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const INTERVAL_MS: u64 = 500;
pub const EVENT: &str = "sidecar-poll-tick";

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(INTERVAL_MS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;
        eprintln!("[poll-clock] {INTERVAL_MS}ms {EVENT}");
        loop {
            interval.tick().await;
            let _ = app.emit(EVENT, ());
        }
    });
}
