use std::collections::VecDeque;

use serde_json::{json, Value};

use crate::scrub_util::{self, REDACTED};
use crate::sentry_config;

// Keep the last few error stages per process without retaining arbitrary stderr text.
const RECENT_LIMIT: usize = 12;
const STDERR_TAIL_MAX_LINES: usize = 40;
const STDERR_TAIL_MAX_BYTES: usize = 4096;
/// ponytail: scrubbed-chunk ceiling — whole stderr records drop from the front only.
const SCRUBBED_BUFFER_CAP_BYTES: usize = 16_384;

#[derive(Default)]
pub(crate) struct StderrDiagnostics {
    chunks_seen: u64,
    unclassified_chunks: u64,
    recent: VecDeque<Value>,
    scrubbed_chunks: VecDeque<String>,
}

/// Line/byte limits only — input must already be scrubbed.
pub(crate) fn format_stderr_tail(scrubbed: &str) -> String {
    let lines: Vec<&str> = scrubbed.lines().collect();
    let skip = lines.len().saturating_sub(STDERR_TAIL_MAX_LINES);
    let mut joined = lines[skip..].join("\n");
    if joined.len() > STDERR_TAIL_MAX_BYTES {
        let mut start = joined.len().saturating_sub(STDERR_TAIL_MAX_BYTES);
        while start < joined.len() && !joined.is_char_boundary(start) {
            start += 1;
        }
        if let Some(nl) = joined[start..].find('\n') {
            start += nl + 1;
        }
        joined = joined[start..].to_string();
    }
    joined
}

fn redact_auth_scheme_value(
    text: &str,
    lower: &str,
    mut i: usize,
    out: &mut String,
    prefix_end: usize,
) -> usize {
    let scheme = if lower[i..].starts_with("bearer") {
        "Bearer "
    } else if lower[i..].starts_with("basic") {
        "Basic "
    } else {
        return (i + 1).min(text.len());
    };
    let scheme_len = scheme.trim_end().len();
    out.push_str(&text[prefix_end..i]);
    i += scheme_len;
    while let Some(c) = text[i..].chars().next() {
        if !c.is_whitespace() {
            break;
        }
        i += c.len_utf8();
    }
    out.push_str(scheme);
    out.push_str(REDACTED);
    text[i..]
        .find(scrub_util::is_value_boundary)
        .map(|at| i + at)
        .unwrap_or(text.len())
}

fn scrub_bearer_headers(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    let auth = "authorization:";
    let bare = "bearer";
    while cursor < text.len() {
        let auth_at = lower[cursor..].find(auth).map(|at| (cursor + at, auth.len()));
        let bare_at = lower[cursor..].find(bare).map(|at| (cursor + at, bare.len()));
        let next = [auth_at, bare_at]
            .into_iter()
            .flatten()
            .min_by_key(|(at, _)| *at);
        let Some((hit, needle_len)) = next else {
            out.push_str(&text[cursor..]);
            break;
        };
        out.push_str(&text[cursor..hit]);
        let mut i = hit + needle_len;
        while let Some(c) = text[i..].chars().next() {
            if !c.is_whitespace() {
                break;
            }
            i += c.len_utf8();
        }
        let next = if needle_len == auth.len() {
            if lower[i..].starts_with("bearer") || lower[i..].starts_with("basic") {
                redact_auth_scheme_value(text, &lower, i, &mut out, hit)
            } else {
                out.push_str(&text[hit..i]);
                text[i..]
                    .find(scrub_util::is_value_boundary)
                    .map(|at| i + at)
                    .unwrap_or(text.len())
            }
        } else {
            redact_auth_scheme_value(text, &lower, hit, &mut out, hit)
        };
        cursor = if next <= hit { hit + 1 } else { next };
    }
    out
}

fn is_email_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-')
}

fn email_local_start(text: &str, at: usize) -> usize {
    let mut start = at;
    while start > 0 {
        let ch = text[..start].chars().last().unwrap();
        if !is_email_char(ch) {
            break;
        }
        start -= ch.len_utf8();
    }
    start
}

fn email_domain_end(text: &str, at: usize) -> usize {
    let mut end = at + '@'.len_utf8();
    while end < text.len() {
        let ch = text[end..].chars().next().unwrap();
        if !is_email_char(ch) {
            break;
        }
        end += ch.len_utf8();
    }
    end
}

/// Forward-only scan: find a full email span in `text`, emit preceding bytes unchanged.
fn scrub_emails(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    while cursor < text.len() {
        let Some(at_rel) = text[cursor..].find('@') else {
            out.push_str(&text[cursor..]);
            break;
        };
        let at = cursor + at_rel;
        let start = email_local_start(text, at);
        let end = email_domain_end(text, at);
        let domain_after_at = at + '@'.len_utf8();
        let valid = start < at && end > domain_after_at && start >= cursor;
        if valid {
            out.push_str(&text[cursor..start]);
            out.push_str(REDACTED);
            cursor = end;
        } else {
            let after_at = domain_after_at;
            out.push_str(&text[cursor..after_at]);
            cursor = after_at;
        }
    }
    out
}

fn ipv4_byte(b: u8) -> bool {
    b.is_ascii_digit()
}

fn scrub_ip_endpoints(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if let Some((end, port_end)) = parse_ipv4_endpoint(text, i) {
            out.push_str(REDACTED);
            i = port_end.max(end);
        } else {
            let ch = text[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn parse_ipv4_endpoint(text: &str, start: usize) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    if start >= bytes.len() || !ipv4_byte(bytes[start]) {
        return None;
    }
    let mut pos = start;
    for part in 0..4 {
        if pos >= bytes.len() || !ipv4_byte(bytes[pos]) {
            return None;
        }
        let part_start = pos;
        let mut value = 0u16;
        while pos < bytes.len() && ipv4_byte(bytes[pos]) {
            value = value.saturating_mul(10).saturating_add((bytes[pos] - b'0') as u16);
            if value > 255 {
                return None;
            }
            pos += 1;
        }
        if part_start == pos {
            return None;
        }
        if part < 3 {
            if pos >= bytes.len() || bytes[pos] != b'.' {
                return None;
            }
            pos += 1;
        }
    }
    let end = pos;
    let mut port_end = pos;
    if pos < bytes.len() && bytes[pos] == b':' {
        pos += 1;
        if pos >= bytes.len() || !ipv4_byte(bytes[pos]) {
            return Some((end, end));
        }
        while pos < bytes.len() && ipv4_byte(bytes[pos]) {
            pos += 1;
        }
        port_end = pos;
    }
    // Avoid redacting version numbers like 1.2.3.4 inside semver-only noise — require context
    // or at least that this isn't glued to alphanumeric on left (simple check).
    if start > 0 {
        let prev = text[..start].chars().last().unwrap();
        if prev.is_ascii_alphanumeric() || prev == '_' {
            return None;
        }
    }
    Some((end, port_end))
}

/// Scrub one complete stderr chunk before it enters the buffer.
const EXTRA_ASSIGNMENT_KEYS: [&str; 2] = ["api_key", "apikey"];

pub(crate) fn scrub_stderr_tail(text: &str) -> String {
    let mut out = scrub_bearer_headers(text);
    out = sentry_config::scrub(&out);
    out = scrub_util::scrub_assignments(&out, &EXTRA_ASSIGNMENT_KEYS);
    out = scrub_bearer_headers(&out);
    out = scrub_util::scrub_authorization_credentials(&out);
    out = scrub_emails(&out);
    out = scrub_ip_endpoints(&out);
    out
}

impl StderrDiagnostics {
    fn push_scrubbed_chunk(&mut self, bytes: &[u8]) {
        let piece = scrub_stderr_tail(&String::from_utf8_lossy(bytes));
        if piece.is_empty() {
            return;
        }
        self.scrubbed_chunks.push_back(piece);
        let mut total: usize = self.scrubbed_chunks.iter().map(String::len).sum();
        while total > SCRUBBED_BUFFER_CAP_BYTES {
            let Some(front) = self.scrubbed_chunks.pop_front() else {
                break;
            };
            total -= front.len();
        }
    }

    pub(crate) fn record(&mut self, bytes: &[u8], uptime_ms: u64) {
        self.chunks_seen = self.chunks_seen.saturating_add(1);
        self.push_scrubbed_chunk(bytes);
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
        let scrubbed: String = previous.scrubbed_chunks.iter().cloned().collect();
        let sidecar_stderr_tail = format_stderr_tail(&scrubbed);
        json!({
            "chunks_seen": previous.chunks_seen,
            "unclassified_chunks": previous.unclassified_chunks,
            "recent": previous.recent,
            "sidecar_stderr_tail": sidecar_stderr_tail,
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
        let tail = evidence["sidecar_stderr_tail"].as_str().unwrap();
        assert!(tail.contains("Traceback"));
        assert!(tail.contains("access violation"));
        for secret in [
            "alice",
            "private.py",
            "supersecret",
            "192.0.2.1",
            "example.com",
        ] {
            assert!(!evidence.to_string().contains(secret), "leaked {secret}");
        }
        assert_eq!(diagnostics.take()["chunks_seen"], 0);
    }

    #[test]
    fn stderr_tail_keeps_last_lines_and_byte_cap() {
        for line in 0..60usize {
            let mut diagnostics = StderrDiagnostics::default();
            for i in 0..=line {
                diagnostics.record(format!("line-{i}\n").as_bytes(), i as u64);
            }
            let tail = diagnostics.take()["sidecar_stderr_tail"]
                .as_str()
                .unwrap()
                .to_string();
            let line_count = tail.lines().count();
            assert!(line_count <= STDERR_TAIL_MAX_LINES, "{line_count} lines at {line}");
            if line >= STDERR_TAIL_MAX_LINES {
                assert!(!tail.contains("line-0\n"));
                assert!(tail.contains(&format!("line-{line}")));
            }
        }

        let filler = "x".repeat(STDERR_TAIL_MAX_BYTES + 500);
        let mut diagnostics = StderrDiagnostics::default();
        diagnostics.record(b"marker-start\n", 0);
        diagnostics.record(filler.as_bytes(), 1);
        diagnostics.record(b"marker-end", 2);
        let tail = diagnostics.take()["sidecar_stderr_tail"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(tail.len() <= STDERR_TAIL_MAX_BYTES);
        assert!(tail.contains("marker-end"));
        assert!(!tail.contains("marker-start"));
    }

    #[test]
    fn stderr_tail_byte_cap_applied_after_scrub() {
        let raw = (0..300)
            .map(|i| format!("line-{i} failed at 10.{i}.{i}.{i}:102 user{i}@example.com api_key=secret{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let tail = format_stderr_tail(&scrub_stderr_tail(&raw));
        assert!(tail.len() <= STDERR_TAIL_MAX_BYTES);
        assert!(!tail.contains("example.com"));
        assert!(!tail.contains("secret"));
    }

    #[test]
    fn scrub_emails_redacts_full_address() {
        let scrubbed = scrub_emails("contact alice.smith@example.com today");
        assert!(!scrubbed.contains("alice"));
        assert!(!scrubbed.contains("smith"));
        assert!(!scrubbed.contains("example.com"));
        assert_eq!(scrubbed, "contact [redacted] today");
    }

    #[test]
    fn scrub_emails_nested_at_preserves_prefix_and_suffix() {
        let scrubbed = scrub_emails("prefix a@abcdefghijkl@x suffix");
        assert_eq!(scrubbed, "prefix [redacted]@x suffix");
        assert!(scrubbed.starts_with("prefix "));
        assert!(scrubbed.ends_with(" suffix"));
    }

    #[test]
    fn scrub_emails_multibyte_neighbors_do_not_panic() {
        let input = "한 a@abcdefghijkl@x 끝";
        let scrubbed = std::panic::catch_unwind(|| scrub_emails(input));
        let scrubbed = scrubbed.expect("scrub_emails must not panic on multibyte text");
        assert!(scrubbed.contains('한'));
        assert!(scrubbed.contains('끝'));
        assert!(!scrubbed.contains("abcdefghijkl"));
        assert!(scrubbed.contains(REDACTED));
    }

    #[test]
    fn scrub_stderr_tail_regression_basic_paths_and_unc() {
        let raw = "authorization=Basic dXNlcjpwYXNz\n\
            path C:/Users/bob/src\n\
            share \\\\nas\\roasts\\log.txt";
        let scrubbed = scrub_stderr_tail(raw);
        assert!(!scrubbed.contains("dXNlcjpwYXNz"));
        assert!(!scrubbed.contains("bob"));
        assert!(!scrubbed.contains("nas"));
    }

    #[test]
    fn scrub_stderr_tail_redacts_paths_secrets_bearer_and_api_key() {
        let raw = "File /Users/alice/app/main.py\n\
            api_key=abc123\n\
            Authorization: Bearer eyJ-leak\n\
            PLC 203.0.113.7:102";
        let scrubbed = scrub_stderr_tail(raw);
        assert!(scrubbed.contains(REDACTED));
        assert!(!scrubbed.contains("alice"));
        assert!(!scrubbed.contains("abc123"));
        assert!(!scrubbed.contains("eyJ-leak"));
        assert!(!scrubbed.contains("203.0.113.7"));
    }

    #[test]
    fn scrub_per_chunk_prevents_truncation_secret_leaks() {
        let mut diagnostics = StderrDiagnostics::default();
        diagnostics.record(
            vec![b'x'; SCRUBBED_BUFFER_CAP_BYTES - 8].as_slice(),
            0,
        );
        diagnostics.record(b"token=leak-me", 1);
        let evidence = diagnostics.take();
        let tail = evidence["sidecar_stderr_tail"].as_str().unwrap_or("");
        assert!(!tail.contains("leak-me"));
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
