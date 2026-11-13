//! Shared PII/scrub helpers for Sentry and sidecar stderr tail.

pub const REDACTED: &str = "[redacted]";

pub const SENSITIVE_ASSIGNMENT_KEYS: [&str; 9] = [
    "password",
    "token",
    "secret",
    "authorization",
    "cookie",
    "host",
    "comport",
    "serial",
    "path",
];

pub const HOME_PATH_MARKERS: [&str; 5] = [
    "/Users/",
    "/home/",
    ":\\Users\\",
    ":/Users/",
    ":/users/",
];

/// 값 경계: 공백과 흔한 구분자에서 멈춘다 (뒤따르는 본문까지 잘리지 않게).
pub fn is_value_boundary(c: char) -> bool {
    c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ';' | ')' | '}' | ']' | '&')
}

/// `key=value` / `key: value` assignments for the given keys (ASCII keys only).
pub fn scrub_assignments(text: &str, keys: &[&str]) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;

    while cursor < text.len() {
        let hit = keys
            .iter()
            .filter_map(|key| lower[cursor..].find(key).map(|at| (cursor + at, key.len())))
            .min_by_key(|(at, _)| *at);

        let Some((key_start, key_len)) = hit else {
            break;
        };
        let after_key = key_start + key_len;
        let mut value_start = after_key;
        let mut saw_separator = false;
        for c in text[after_key..].chars() {
            match c {
                '"' | '\'' | ' ' | '\t' => value_start += c.len_utf8(),
                '=' | ':' if !saw_separator => {
                    saw_separator = true;
                    value_start += c.len_utf8();
                }
                _ => break,
            }
        }
        if !saw_separator || value_start >= text.len() {
            out.push_str(&text[cursor..after_key]);
            cursor = after_key;
            continue;
        }
        let value_end = text[value_start..]
            .find(is_value_boundary)
            .map(|at| value_start + at)
            .unwrap_or(text.len());
        if value_end == value_start {
            out.push_str(&text[cursor..after_key]);
            cursor = after_key;
            continue;
        }
        out.push_str(&text[cursor..value_start]);
        out.push_str(REDACTED);
        cursor = value_end;
    }

    out.push_str(&text[cursor.min(text.len())..]);
    out
}

fn path_token_needs_redaction(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    if HOME_PATH_MARKERS.iter().any(|marker| lower.contains(&marker.to_ascii_lowercase())) {
        return true;
    }
    lower.starts_with("\\\\") && lower.len() > 2
}

pub fn scrub_paths(text: &str) -> String {
    text.split_inclusive(char::is_whitespace)
        .map(|token| {
            if path_token_needs_redaction(token) {
                let trailing = token.len() - token.trim_end().len();
                format!("{REDACTED}{}", &token[token.len() - trailing..])
            } else {
                token.to_owned()
            }
        })
        .collect()
}

pub fn scrub_authorization_credentials(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let needles = ["authorization=", "authorization:"];
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    while cursor < text.len() {
        let hit = needles
            .iter()
            .filter_map(|needle| lower[cursor..].find(needle).map(|at| (cursor + at, needle.len())))
            .min_by_key(|(at, _)| *at);
        let Some((start, needle_len)) = hit else {
            break;
        };
        out.push_str(&text[cursor..start]);
        let line_end = text[start..]
            .find('\n')
            .map(|i| start + i)
            .unwrap_or(text.len());
        out.push_str(&text[start..start + needle_len]);
        out.push(' ');
        out.push_str(REDACTED);
        cursor = line_end;
    }
    out.push_str(&text[cursor.min(text.len())..]);
    out
}

pub fn scrub_known_assignments_and_paths(text: &str) -> String {
    let mut out = scrub_authorization_credentials(text);
    out = scrub_assignments(&out, &SENSITIVE_ASSIGNMENT_KEYS);
    if HOME_PATH_MARKERS
        .iter()
        .any(|marker| out.to_ascii_lowercase().contains(&marker.to_ascii_lowercase()))
        || out.contains("\\\\")
    {
        out = scrub_paths(&out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubs_authorization_equals_basic_credential() {
        let scrubbed = scrub_known_assignments_and_paths("authorization=Basic dXNlcjpwYXNz");
        assert!(!scrubbed.contains("dXNlcjpwYXNz"), "{scrubbed}");
        assert!(scrubbed.contains(REDACTED), "{scrubbed}");
    }

    #[test]
    fn scrubs_windows_drive_and_unc_paths() {
        let scrubbed = scrub_known_assignments_and_paths(
            "at C:/Users/alice/app and \\\\fileserver\\roasts\\log.txt",
        );
        assert!(!scrubbed.contains("alice"), "{scrubbed}");
        assert!(!scrubbed.contains("fileserver"), "{scrubbed}");
    }
}
