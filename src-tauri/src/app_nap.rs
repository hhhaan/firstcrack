//! macOS App Nap 억제.
//!
//! `LSAppNapIsDisabled` Info.plist는 최신 macOS에서 무시된다. localhost 폴링도
//! Nap을 막지 못한다. 토큰을 프로세스 수명 동안 붙잡아야 한다.
//! Artisan `appnope.nope()` 과 같은 API. #308 1단.

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_foundation::{ns_string, NSActivityOptions, NSProcessInfo};
    use std::sync::OnceLock;

    /// `beginActivity` 반환 객체. 보유가 곧 Nap 억제 — 다른 스레드로 옮기지 않는다.
    struct Token {
        #[allow(dead_code)]
        activity: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    }
    unsafe impl Send for Token {}
    unsafe impl Sync for Token {}

    static TOKEN: OnceLock<Token> = OnceLock::new();

    pub fn hold() {
        if TOKEN.get().is_some() {
            return;
        }
        let options = NSActivityOptions::UserInitiated | NSActivityOptions::LatencyCritical;
        let activity = NSProcessInfo::processInfo()
            .beginActivityWithOptions_reason(options, ns_string!("First Crack roast sampling"));
        if TOKEN.set(Token { activity }).is_ok() {
            eprintln!("[app-nap] beginActivity UserInitiated|LatencyCritical");
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn hold() {}
}

pub fn hold() {
    imp::hold();
}
