use std::collections::VecDeque;

use serde_json::{json, Value};

// Keep the last few error stages per process without retaining arbitrary stderr text.
const RECENT_LIMIT: usize = 12;

#[derive(Default)]
pub(crate) struct StderrDiagnostics {
    chunks_seen: u64,
    unclassified_chunks: u64,
    recent: VecDeque<Value>,
}

impl StderrDiagnostics {
    pub(crate) fn record(&mut self, bytes: &[u8], uptime_ms: u64) {
        self.chunks_seen = self.chunks_seen.saturating_add(1);
        let text = String::from_utf8_lossy(bytes).to_lowercase();
        let mut observed_codes = Vec::new();
        for (pattern, code) in [
            ("fatal python error", "python_fatal"),
            ("access violation", "access_violation"),
            ("segmentation fault", "segmentation_fault"),
            ("stack overflow", "stack_overflow"),
            ("failed to execute script", "bootloader_script_failed"),
            ("failed to load python", "python_load_failed"),
            ("dll load failed", "dll_load_failed"),
            ("modulenotfounderror", "module_not_found"),
            ("importerror", "import_error"),
            ("permissionerror", "permission_error"),
            ("address already in use", "address_in_use"),
            ("winerror 10048", "address_in_use"),
            ("traceback (most recent call last)", "python_traceback"),
            ("timeouterror", "timeout"),
            ("connection timed out", "timeout"),
            ("connection refused", "connection_refused"),
            ("connection reset", "connection_reset"),
            ("address out of range", "s7_address_out_of_range"),
            ("function refused", "s7_function_refused"),
            ("error occurred during recv", "s7_receive_error"),
            ("s7 읽기 예산", "s7_read_budget"),
            ("s7 i/o 락 대기", "s7_lock_timeout"),
            ("s7 읽기 실패", "s7_read_failed"),
            ("s7 actuator command failed", "s7_actuator_failed"),
            ("재연결 실패", "reconnect_failed"),
            ("연결 실패", "connect_failed"),
        ] {
            if !text.contains(pattern)
                || observed_codes.contains(&code)
                || (code == "connect_failed" && observed_codes.contains(&"reconnect_failed"))
            {
                continue;
            }
            observed_codes.push(code);
            if let Some(entry) = self.recent.back_mut().filter(|entry| entry["code"] == code) {
                let count = entry["count"].as_u64().unwrap_or(0).saturating_add(1);
                entry["count"] = json!(count);
                entry["last_uptime_ms"] = json!(uptime_ms);
            } else {
                if self.recent.len() == RECENT_LIMIT {
                    self.recent.pop_front();
                }
                self.recent.push_back(json!({
                    "code": code,
                    "count": 1,
                    "first_uptime_ms": uptime_ms,
                    "last_uptime_ms": uptime_ms,
                }));
            }
        }
        if observed_codes.is_empty() {
            self.unclassified_chunks = self.unclassified_chunks.saturating_add(1);
        }
    }

    pub(crate) fn take(&mut self) -> Value {
        let previous = std::mem::take(self);
        json!({
            "chunks_seen": previous.chunks_seen,
            "unclassified_chunks": previous.unclassified_chunks,
            "recent": previous.recent,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_failure_stages_without_stderr_secrets_or_paths() {
        let mut diagnostics = StderrDiagnostics::default();
        diagnostics.record(b"Traceback (most recent call last):", 10);
        diagnostics.record(b"File C:\\Users\\alice\\private.py token=supersecret", 11);
        diagnostics.record(b"TimeoutError: PLC 192.0.2.1:102 user@example.com", 20);
        diagnostics.record(b"Windows fatal exception: access violation", 21);
        let evidence = diagnostics.take();
        assert_eq!(evidence["chunks_seen"], 4);
        assert_eq!(evidence["unclassified_chunks"], 1);
        assert_eq!(evidence["recent"][0]["code"], "python_traceback");
        assert_eq!(evidence["recent"][1]["code"], "timeout");
        assert_eq!(evidence["recent"][2]["code"], "access_violation");
        for secret in [
            "alice",
            "private.py",
            "supersecret",
            "192.0.2.1",
            "example.com",
        ] {
            assert!(!evidence.to_string().contains(secret));
        }
        assert_eq!(diagnostics.take()["chunks_seen"], 0);
    }

    #[test]
    fn counts_one_chunk_once_when_timeout_patterns_overlap() {
        let mut diagnostics = StderrDiagnostics::default();
        diagnostics.record(b"TimeoutError: connection timed out", 1);
        assert_eq!(diagnostics.take()["recent"][0]["count"], 1);
    }

    #[test]
    fn reconnect_failure_is_not_an_initial_connect_failure() {
        let mut diagnostics = StderrDiagnostics::default();
        diagnostics.record("재연결 실패 (2)".as_bytes(), 1);
        let evidence = diagnostics.take();
        assert_eq!(evidence["recent"].as_array().unwrap().len(), 1);
        assert_eq!(evidence["recent"][0]["code"], "reconnect_failed");
    }

    #[test]
    fn bounds_history_and_counts_repeated_failures() {
        let mut diagnostics = StderrDiagnostics::default();
        for at in 0..100 {
            diagnostics.record(b"TimeoutError", at);
        }
        let repeated = diagnostics.take();
        assert_eq!(repeated["recent"].as_array().unwrap().len(), 1);
        assert_eq!(repeated["recent"][0]["count"], 100);
        assert_eq!(repeated["recent"][0]["last_uptime_ms"], 99);
        for at in 0..100 {
            diagnostics.record(b"DLL load failed; ImportError", at);
        }
        assert_eq!(
            diagnostics.take()["recent"].as_array().unwrap().len(),
            RECENT_LIMIT
        );
    }
}
