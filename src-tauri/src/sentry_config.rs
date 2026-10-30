//! Rust 프로세스 Sentry 단일 통합 지점.
//!
//! 프론트엔드(`src/shared/lib/sentry.ts`)·사이드카(`src-tauri/sidecar/sentry_config.py`)와
//! 같은 프로젝트 하나를 쓰고 `runtime` 태그로만 갈린다. 정책도 셋이 동일하다:
//!
//! - release 이름 컨벤션은 `first-crack@<앱 버전>`. `sentry::release_name!()`은 crate 이름
//!   (`roastery-agent@x`)을 쓰므로 프론트와 릴리스가 갈라진다 — 쓰지 않는다.
//! - 자동 활성은 release 빌드만. debug는 `SENTRY_SMOKE=1|true`일 때만 켠다.
//! - 조치 가능한 오류만 이슈로. 정보성 메시지·중간 재시도 실패는 breadcrumb으로 남긴다.
//! - 비밀·로컬 경로는 `before_send`/`before_breadcrumb` 한 곳에서만 지운다.

use std::borrow::Cow;
use std::sync::Arc;

// DSN은 클라이언트 공개값 (프론트/사이드카도 동일하게 하드코딩) — 빌드 시크릿 의존 제거
const SENTRY_DSN: &str =
    "https://a7ad70395dfd0d01e1a94e04fdf4e0e1@o4511400846884864.ingest.us.sentry.io/4511400857042944";

const REDACTED: &str = "[redacted]";

/// debug 빌드에서 SDK를 켜는 명시 opt-in. 프론트 `VITE_SENTRY_SMOKE`와 같은 역할.
fn is_smoke() -> bool {
    matches!(
        std::env::var("SENTRY_SMOKE").as_deref().map(str::trim),
        Ok("1") | Ok("true")
    )
}

/// release 빌드는 자동, debug는 스모크 opt-in.
pub fn is_enabled() -> bool {
    !cfg!(debug_assertions) || is_smoke()
}

pub fn release_name(version: &str) -> String {
    format!("first-crack@{version}")
}

fn environment() -> &'static str {
    if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    }
}

/// `key=value` / `key: value` 형태의 비밀·연결정보와 사용자 홈 경로를 지운다.
///
/// 정규식 의존성을 새로 들이지 않으려고 수동 스캔으로 처리한다.
/// ponytail: 천장은 아래 키 목록과 홈 디렉터리 접두 3종 — 더 넓은 스크러빙이 필요해지면
/// `regex` crate로 교체하고 프론트 `SENSITIVE_ASSIGNMENT`와 패턴을 맞춘다.
const SENSITIVE_KEYS: [&str; 9] = [
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

const HOME_PREFIXES: [&str; 3] = ["/Users/", "/home/", ":\\Users\\"];

pub fn scrub(text: &str) -> String {
    let mut out = scrub_assignments(text);
    if HOME_PREFIXES.iter().any(|p| out.contains(p)) {
        out = scrub_paths(&out);
    }
    out
}

/// 값 경계: 공백과 흔한 구분자에서 멈춘다 (뒤따르는 본문까지 잘리지 않게).
fn is_value_boundary(c: char) -> bool {
    c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ';' | ')' | '}' | ']' | '&')
}

fn scrub_assignments(text: &str) -> String {
    // to_lowercase()가 아니라 ASCII 전용 — 유니코드 소문자화는 바이트 길이를 바꿔
    // `text`와 인덱스가 어긋난다(슬라이싱 패닉). 민감 키는 모두 ASCII다.
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;

    while cursor < text.len() {
        // 남은 구간에서 가장 먼저 등장하는 민감 키를 찾는다.
        let hit = SENSITIVE_KEYS
            .iter()
            .filter_map(|key| lower[cursor..].find(key).map(|at| (cursor + at, key.len())))
            .min_by_key(|(at, _)| *at);

        let Some((key_start, key_len)) = hit else {
            break;
        };
        let after_key = key_start + key_len;

        // 키 뒤 `=` 또는 `:` (따옴표·공백 허용). 없으면 이 키는 대입이 아니다.
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

fn scrub_paths(text: &str) -> String {
    text.split_inclusive(char::is_whitespace)
        .map(|token| {
            if HOME_PREFIXES.iter().any(|p| token.contains(p)) {
                let trailing = token.len() - token.trim_end().len();
                format!("{REDACTED}{}", &token[token.len() - trailing..])
            } else {
                token.to_owned()
            }
        })
        .collect()
}

fn scrub_event(
    mut event: sentry::protocol::Event<'static>,
) -> Option<sentry::protocol::Event<'static>> {
    event.server_name = None;
    // runtime 태그는 여기서 붙인다 — scope는 훅/스레드마다 갈릴 수 있지만
    // before_send는 나가는 모든 이벤트가 반드시 통과한다.
    event.tags.insert("runtime".to_owned(), "tauri".to_owned());
    if let Some(message) = event.message.take() {
        event.message = Some(scrub(&message));
    }
    for exception in event.exception.values.iter_mut() {
        if let Some(value) = exception.value.take() {
            exception.value = Some(scrub(&value));
        }
    }
    for crumb in event.breadcrumbs.values.iter_mut() {
        if let Some(message) = crumb.message.take() {
            crumb.message = Some(scrub(&message));
        }
    }
    Some(event)
}

/// 앱 시작 시 1회. `tauri_plugin_sentry::init`에 넘길 클라이언트를 돌려준다.
/// 비활성(스모크 없는 debug 빌드)이면 `None`.
pub fn init(version: &str) -> Option<Arc<sentry::Client>> {
    if !is_enabled() {
        return None;
    }

    let options = (
        SENTRY_DSN,
        sentry::ClientOptions {
            release: Some(Cow::Owned(release_name(version))),
            environment: Some(Cow::Borrowed(environment())),
            traces_sample_rate: 0.1,
            send_default_pii: false,
            before_send: Some(Arc::new(scrub_event)),
            before_breadcrumb: Some(Arc::new(|mut crumb: sentry::Breadcrumb| {
                if let Some(message) = crumb.message.take() {
                    crumb.message = Some(scrub(&message));
                }
                Some(crumb)
            })),
            ..Default::default()
        },
    ).into();
    let client = sentry::Client::from(sentry::apply_defaults(options));

    let client = Arc::new(client);
    sentry::Hub::main().bind_client(Some(client.clone()));
    Some(client)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialization_enables_event_transport() {
        if std::env::var_os("FC_SENTRY_INIT_TEST_CHILD").is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "sentry_config::tests::initialization_enables_event_transport",
                    "--nocapture",
                ])
                .env("FC_SENTRY_INIT_TEST_CHILD", "1")
                .env("SENTRY_SMOKE", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr),
            );
            return;
        }

        let client = init("1.3.10").expect("smoke mode enables the client");
        let enabled = client.is_enabled();
        let has_transport = client.options().transport.is_some();
        // Assertions must not report test failures to production through the panic integration.
        client.close(Some(std::time::Duration::ZERO));
        sentry::Hub::main().bind_client(None);
        assert!(enabled, "a DSN without a transport silently drops events");
        assert!(has_transport);
        assert_eq!(client.options().release.as_deref(), Some("first-crack@1.3.10"));
    }

    #[test]
    fn release_uses_app_name_not_crate_name() {
        assert_eq!(release_name("1.1.32"), "first-crack@1.1.32");
    }

    #[test]
    fn excludes_computer_name_from_event() {
        let event = sentry::protocol::Event {
            server_name: Some("customer-pc".into()),
            ..Default::default()
        };
        assert!(scrub_event(event).unwrap().server_name.is_none());
    }

    #[test]
    fn scrubs_sensitive_assignments() {
        assert_eq!(
            scrub("connect failed host=10.0.0.2 attempt=3"),
            "connect failed host=[redacted] attempt=3"
        );
        assert_eq!(scrub("SIDECAR_TOKEN=deadbeef"), "SIDECAR_TOKEN=[redacted]");
        assert_eq!(
            scrub("comport: \"COM3\", baud: 9600"),
            "comport: \"[redacted]\", baud: 9600"
        );
    }

    #[test]
    fn scrubs_home_paths() {
        let scrubbed = scrub("[startup] v1.1.32 from /Users/alice/Applications/First Crack.app");
        assert!(!scrubbed.contains("alice"), "{scrubbed}");
    }

    #[test]
    fn leaves_plain_text_alone() {
        assert_eq!(scrub("sidecar restart 2/3"), "sidecar restart 2/3");
    }
}
