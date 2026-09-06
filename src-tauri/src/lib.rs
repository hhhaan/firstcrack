mod app_nap;
#[cfg(desktop)]
mod poll_clock;
mod sentry_config;

use tauri::RunEvent;
#[cfg(desktop)]
use std::io::{Read, Write};
#[cfg(desktop)]
use std::net::TcpStream;
#[cfg(desktop)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use std::time::Duration;
#[cfg(desktop)]
use std::time::Instant;
#[cfg(desktop)]
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri_plugin_shell::ShellExt;
#[cfg(desktop)]
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

#[cfg(desktop)]
struct SidecarChild(Mutex<Option<CommandChild>>);

/// 사이드카 HTTP 인증 토큰. 앱 프로세스당 1개 — 최초 spawn·respawn·/shutdown이 모두 이 값을 쓴다.
#[cfg(desktop)]
struct SidecarToken(String);

/// 사이드카 자동 재시작 백오프 (초). 길이 = 최대 시도 횟수.
#[cfg(desktop)]
const RESTART_BACKOFFS_SECS: [u64; 3] = [2, 5, 10];

/// 사이드카 HTTP 토큰 생성.
///
/// 위협 모델: `127.0.0.1:9999`는 로컬 브라우저(Safari/Firefox)나 다른 로컬 프로세스가
/// 그냥 호출할 수 있어 `/shutdown`·`/disconnect`가 로컬 CSRF 벡터다. 토큰은 프로세스
/// env로만 전달되며 웹 페이지는 이를 읽을 수 없다 — 즉 "추측 불가"면 충분하고,
/// 암호학적 키가 아니다. 그래서 외부 crypto 의존성 없이 OS 엔트로피로 시드되는
/// `RandomState`(SipHash 키)를 사용한다.
#[cfg(desktop)]
fn generate_sidecar_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or_default();

    let mut token = String::with_capacity(32);
    for salt in 0..2u64 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(nanos ^ salt);
        hasher.write_u32(std::process::id());
        token.push_str(&format!("{:016x}", hasher.finish()));
    }
    token
}

/// 프론트엔드(`src/shared/lib/sidecar.ts`)가 `X-Sidecar-Token` 헤더에 실을 토큰.
#[cfg(desktop)]
#[tauri::command]
fn sidecar_token(app: tauri::AppHandle) -> String {
    app.state::<SidecarToken>().0.clone()
}

/// 준비 완료 판정: HTTP 200만 인정한다.
/// 401은 이전 프로세스의 토큰을 든 좀비 사이드카라는 뜻이므로 준비된 게 아니다.
#[cfg(desktop)]
fn is_ready_response(response: &[u8]) -> bool {
    response.starts_with(b"HTTP/1.1 200 ") || response.starts_with(b"HTTP/1.0 200 ")
}

/// 현재 앱 토큰으로 `/status`를 호출해 준비 여부를 판정.
///
/// TCP 연결만으로 판정하면 안 된다 — 죽어가는 좀비 사이드카가 포트를 약 1초간
/// 계속 accept하면서 이전 토큰을 들고 있는 구간이 실제 로그로 확인됐다.
/// 그 구간에는 연결은 되지만 우리 토큰에는 401이 돌아온다.
#[cfg(desktop)]
fn probe_sidecar_ready(token: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:9999".parse().unwrap(),
        Duration::from_millis(200),
    ) else {
        return false;
    };
    // 타임아웃을 못 걸었으면 read가 무한 블로킹될 수 있다 — 준비 판정을 포기하고 다음 주기에 재시도.
    if stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .is_err()
    {
        return false;
    }
    let request = format!(
        "GET /status HTTP/1.0\r\nHost: 127.0.0.1\r\nX-Sidecar-Token: {token}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    // status line 앞 32바이트만 읽는다 — 판정에 필요한 건 "HTTP/1.x 200 "뿐.
    let mut response = [0_u8; 32];
    match stream.read(&mut response) {
        Ok(size) => is_ready_response(&response[..size]),
        Err(_) => false,
    }
}

/// 준비 감시 세대. `watch_sidecar_ready` 호출마다 +1 되고, 자기 세대가 아닌 워처는 은퇴한다.
#[cfg(desktop)]
static READY_WATCHER_GENERATION: AtomicU64 = AtomicU64::new(0);

/// 새 워처 세대를 발급. 이 시점부터 이전 세대는 모두 무효다.
#[cfg(desktop)]
fn claim_watcher_generation() -> u64 {
    READY_WATCHER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

#[cfg(desktop)]
fn is_latest_watcher(generation: u64) -> bool {
    READY_WATCHER_GENERATION.load(Ordering::SeqCst) == generation
}

/// spawn 성공 후 실제 인증 응답이 올 때까지 폴링하고, 그때 `sidecar-ready`를 emit.
/// spawn 성공 ≠ HTTP 서버 bind 완료이므로 프로세스 기동만으로 emit하면 프론트가 너무 빨리 붙는다.
///
/// bind 전에 죽은 사이드카의 워처가 남아 있으면 재시작으로 뜬 워처와 함께 같은 200을 보고
/// `sidecar-ready`를 중복 emit한다. 그래서 세대 카운터로 최신 워처 1개만 살려둔다 —
/// 세대는 spawn 스레드에서 미리 올려서(스레드 시작 순서에 의존하지 않도록) 넘긴다.
#[cfg(desktop)]
fn watch_sidecar_ready(app: tauri::AppHandle) {
    let generation = claim_watcher_generation();
    std::thread::spawn(move || {
        let token = app.state::<SidecarToken>().0.clone();
        loop {
            // 더 새로운 워처가 떴으면 여기서 종료 — 폴링도 emit도 하지 않는다.
            if !is_latest_watcher(generation) {
                return;
            }
            if probe_sidecar_ready(&token) {
                // probe에 최대 400ms가 걸리므로 그 사이 세대가 바뀔 수 있다 → emit 직전 재확인.
                if is_latest_watcher(generation) {
                    let _ = app.emit("sidecar-ready", ());
                }
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

/// 업데이트 적용 재시작. single-instance 소켓을 먼저 제거해 재시작 프로세스가 즉시 종료되지 않도록 한다.
#[cfg(desktop)]
#[tauri::command]
fn relaunch_for_update(app: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_single_instance::destroy(&app);
    app.request_restart();
    Ok(())
}


/// 포트 9999를 점유한 프로세스가 우리 사이드카 바이너리인지 확인 후 kill.
/// 정상 twin이 없다고 single-instance 플러그인이 이미 보장한 상태에서만 호출된다.
#[cfg(desktop)]
fn kill_zombie_sidecar() {
    #[cfg(not(target_os = "windows"))]
    {
        // lsof -t: PID만 출력, -i tcp:9999: 해당 포트 리스너/연결만 필터
        let pid_output = std::process::Command::new("sh")
            .args(["-c", "lsof -ti tcp:9999 2>/dev/null"])
            .output();

        if let Ok(out) = pid_output {
            let pids = String::from_utf8_lossy(&out.stdout);
            for pid_str in pids.split_whitespace() {
                // ps -o comm=: 실행 파일 basename만 출력 (경로 없음).
                // Tauri externalBin 규약상 바이너리는 "sidecar-<target-triple>" 형태이므로
                // contains("sidecar")가 확실히 매칭된다.
                let name_check = std::process::Command::new("sh")
                    .args(["-c", &format!("ps -p {pid_str} -o comm= 2>/dev/null")])
                    .output();
                if let Ok(n) = name_check {
                    let name = String::from_utf8_lossy(&n.stdout).to_lowercase();
                    // release에서는 "sidecar"만 매칭 — 사용자의 무관한 python 서버 오살 방지 (W3)
                    // debug에서는 "python"도 추가해 venv dev 서버 정리 허용
                    let should_kill = name.contains("sidecar")
                        || (cfg!(debug_assertions) && name.contains("python"));
                    if should_kill {
                        let _ = std::process::Command::new("kill")
                            .args(["-9", pid_str])
                            .output();
                        eprintln!("[sidecar-guard] 좀비 사이드카 kill: PID {pid_str}");
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // netstat -ano 출력을 받아 Rust에서 직접 ":9999" 필터링.
        // (콜론이 포트 경계 역할을 함: "127.0.0.1:19999"에서 ':' 다음 문자는 '1'이라 불일치)
        let netstat = std::process::Command::new("netstat")
            .args(["-ano"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(out) = netstat {
            let text = String::from_utf8_lossy(&out.stdout);
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            for line in text.lines() {
                // ":9999"를 포함하지 않는 라인은 스킵 (findstr :9999 대체)
                if !line.contains(":9999") {
                    continue;
                }
                // netstat 출력의 마지막 컬럼이 PID
                let pid = match line.split_whitespace().last() {
                    Some(p) => p.to_string(),
                    None => continue,
                };
                // 숫자가 아닌 토큰(헤더 행 등) 제외
                if pid.is_empty() || !pid.chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
                if !seen.insert(pid.clone()) {
                    continue;
                }
                // tasklist: 프로세스 이름 검증 후 우리 사이드카일 때만 kill (직접 호출)
                let tasklist = std::process::Command::new("tasklist")
                    .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
                if let Ok(t) = tasklist {
                    let name = String::from_utf8_lossy(&t.stdout).to_lowercase();
                    // /T: 부트로더→자식 전체 트리 킬 (W2). release는 "sidecar"만 (W3).
                    let should_kill = name.contains("sidecar")
                        || (cfg!(debug_assertions) && name.contains("python"));
                    if should_kill {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/T", "/PID", &pid])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        eprintln!("[sidecar-guard] Windows 좀비 사이드카 kill: PID {pid}");
                    }
                }
            }
        }
    }
}


/// 메인 창 크기: Windows는 기본 시작 크기 축소, 모든 OS는 모니터 work area에 맞춤.
/// `tauri.conf.json`의 min은 OS 공통(1024×680). default(1260×810)는 mac 유지.
#[cfg(desktop)]
fn configure_main_window(app: &tauri::App) {
    use tauri::{LogicalSize, Size};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    // Windows: conf 기본값(1260×810)이 DPI 스케일에서 체감상 큼 → 시작 크기만 축소
    #[cfg(target_os = "windows")]
    {
        let _ = window.set_size(Size::Logical(LogicalSize::new(1100.0, 720.0)));
        let _ = window.center();
    }

    // 고DPI / 작은 노트북: preferred가 work area를 넘으면 클램프 (전 OS)
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let work = monitor.work_area().size;
        let max_w = work.width as f64 / scale * 0.95;
        let max_h = work.height as f64 / scale * 0.95;

        if let Ok(physical) = window.inner_size() {
            let cur_w = physical.width as f64 / scale;
            let cur_h = physical.height as f64 / scale;
            if cur_w > max_w || cur_h > max_h {
                let _ = window.set_size(Size::Logical(LogicalSize::new(
                    cur_w.min(max_w),
                    cur_h.min(max_h),
                )));
                let _ = window.center();
            }
        }
    }
}

/// 사이드카 1회 스폰. 최초 spawn과 워치독 재시작이 같은 env를 쓰도록 한 곳에 모은다.
/// (예전에는 재시작 경로가 `SIDECAR_VERSION`을 빠뜨려 Sentry release가 어긋났다.)
#[cfg(desktop)]
fn spawn_sidecar(
    app: &tauri::AppHandle,
) -> Result<
    (
        tauri::async_runtime::Receiver<CommandEvent>,
        CommandChild,
    ),
    Box<dyn std::error::Error>,
> {
    let parent_pid = std::process::id().to_string();
    let version = app.package_info().version.to_string();
    let token = app.state::<SidecarToken>().0.clone();
    let (rx, child) = app
        .shell()
        .sidecar("sidecar")?
        .env("SIDECAR_PARENT_PID", &parent_pid)
        .env("SIDECAR_VERSION", &version)
        .env("SIDECAR_TOKEN", &token)
        .spawn()?;
    Ok((rx, child))
}

/// 사이드카 스폰 + stdout/stderr 드레인 + 백오프 재시작 워치독. 데스크톱 전용.
///
/// 최초 spawn 실패는 **비치명**이다 — 바이너리 누락/권한/안티바이러스 차단으로
/// 앱 전체가 못 뜨면 재고·히스토리 등 사이드카가 필요 없는 기능까지 막힌다.
/// 실패 시에는 자식 없이 워치독 루프에 진입해 백오프 재시도하고, 모두 실패하면
/// 기존 `sidecar-dead` 이벤트로 UI에 알린다 (그 시점엔 webview가 리스너를 붙인 뒤다).
#[cfg(desktop)]
fn spawn_and_watch_sidecar(app: &tauri::App) {
    // DEBUG: `tauri dev` 시 beforeDevCommand가 띄운 venv Python 사이드카를
    // 존중한다. 포트 9999가 이미 응답하면 스폰을 건너뜀 (X1).
    #[cfg(debug_assertions)]
    {
        if std::net::TcpStream::connect_timeout(
            &"127.0.0.1:9999".parse().unwrap(),
            std::time::Duration::from_millis(300),
        ).is_ok() {
            eprintln!("[sidecar-guard] debug: 포트 9999 감지 — 외부 dev 사이드카 존중, 스폰 건너뜀");
            return;
        }
    }

    // Single-instance 플러그인이 twin 없음을 보장한 이후이므로,
    // 포트를 점유한 프로세스는 이전 크래시의 좀비다.
    // healthy 여부와 무관하게 항상 정리 (비응답 좀비도 포트를 점유할 수 있음).
    kill_zombie_sidecar();
    std::thread::sleep(std::time::Duration::from_millis(200));

    let app_handle = app.handle().clone();
    let initial_rx = match spawn_sidecar(&app_handle) {
        Ok((rx, child)) => {
            *app_handle.state::<SidecarChild>().0.lock().unwrap() = Some(child);
            watch_sidecar_ready(app_handle.clone());
            Some(rx)
        }
        Err(e) => {
            eprintln!("[sidecar] 최초 spawn 실패 (앱은 계속 기동): {e}");
            sentry::capture_message(
                &format!("[sidecar-spawn-failed] 최초 spawn 실패: {e}"),
                sentry::Level::Error,
            );
            None
        }
    };

    // stdout/stderr 드레인 + Terminated 감지 시 백오프 재시작.
    // 30초 미만 생존은 "빠른 사망"으로 간주해 attempts 증가 (C2).
    tauri::async_runtime::spawn(async move {
        let mut current_rx = initial_rx;
        // 최초 spawn이 실패했으면 이미 1회 실패한 상태로 루프를 시작한다.
        let mut attempts: usize = if current_rx.is_some() { 0 } else { 1 };
        let mut spawned_at = Instant::now();

        loop {
            if let Some(rx) = current_rx.as_mut() {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            print!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprint!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[sidecar] terminated: code={:?}", payload.code);
                            // 이슈로 만들지 않는다 — 정상 종료·앱 종료·재시작으로 회복되는
                            // 경우가 대부분이다. 조치가 필요한 건 아래 sidecar-dead뿐이고,
                            // 그 이벤트에 이 breadcrumb들이 붙어 경위를 보여준다.
                            sentry::add_breadcrumb(sentry::Breadcrumb {
                                category: Some("sidecar".into()),
                                level: sentry::Level::Warning,
                                message: Some(format!(
                                    "terminated: code={:?} after {:.0}s",
                                    payload.code,
                                    spawned_at.elapsed().as_secs_f64(),
                                )),
                                ..Default::default()
                            });
                            break;
                        }
                        _ => {}
                    }
                }

                // 30초 미만 생존 = 빠른 사망 → 실패로 카운트. 충분히 살았으면 리셋.
                if spawned_at.elapsed() < std::time::Duration::from_secs(30) {
                    attempts += 1;
                } else {
                    attempts = 0;
                }
                current_rx = None;
            }

            if attempts >= RESTART_BACKOFFS_SECS.len() {
                eprintln!(
                    "[sidecar-restart] {}회 재시작 모두 실패 — 사이드카 복구 포기",
                    RESTART_BACKOFFS_SECS.len()
                );
                sentry::capture_message(
                    &format!(
                        "[sidecar-dead] {}회 재시작 모두 실패 — 복구 포기",
                        RESTART_BACKOFFS_SECS.len()
                    ),
                    sentry::Level::Error,
                );
                let _ = app_handle.emit("sidecar-dead", ());
                break;
            }

            let delay = RESTART_BACKOFFS_SECS[attempts.saturating_sub(1).min(RESTART_BACKOFFS_SECS.len() - 1)];
            eprintln!(
                "[sidecar-restart] {}초 후 재시작 ({}/{})",
                delay,
                attempts,
                RESTART_BACKOFFS_SECS.len()
            );
            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;

            // 재시작 직전 좀비 가드 — 비응답 좀비도 무조건 정리
            kill_zombie_sidecar();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;

            match spawn_sidecar(&app_handle) {
                Ok((new_rx, new_child)) => {
                    *app_handle.state::<SidecarChild>().0.lock().unwrap() = Some(new_child);
                    watch_sidecar_ready(app_handle.clone());
                    current_rx = Some(new_rx);
                    spawned_at = Instant::now();
                    eprintln!("[sidecar-restart] 재시작 성공");
                }
                Err(e) => {
                    eprintln!("[sidecar-restart] spawn 실패: {e}");
                    // 중간 재시도 실패는 아직 조치 대상이 아니다 — 소진돼야 이슈다.
                    sentry::add_breadcrumb(sentry::Breadcrumb {
                        category: Some("sidecar".into()),
                        level: sentry::Level::Error,
                        message: Some(format!("restart spawn failed ({attempts}): {e}")),
                        ..Default::default()
                    });
                    attempts += 1;
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // context를 먼저 만들어 tauri.conf.json의 앱 버전(= 프론트 release와 같은 값)을
    // 읽는다. sentry::release_name!()은 crate 이름을 써서 roastery-agent@x가 된다.
    let context = tauri::generate_context!();
    let sentry_client = sentry_config::init(&context.package_info().version.to_string());

    let builder = tauri::Builder::default();

    // 데스크톱 전용: single-instance(반드시 첫 번째, deep-link feature로 OAuth 콜백을 기존 인스턴스에 전달),
    // 업데이터/재시작, 사이드카 핸들. 모바일은 스토어 배포 + LAN 사이드카 허브 접속이라 해당 없음.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            // deep-link 플러그인이 못 받은 경우 argv에서 직접 전달 (백업)
            for arg in args {
                if arg.contains("firstcrack://") && arg.contains("auth/callback") {
                    let _ = app.emit("oauth-callback-url", arg.clone());
                }
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        // CommandChild has no Drop impl — storing via manage() keeps it alive for the app lifetime.
        .manage(SidecarChild(Mutex::new(None)))
        .manage(SidecarToken(generate_sidecar_token()))
        .invoke_handler(tauri::generate_handler![relaunch_for_update, sidecar_token]);

    let mut builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init());

    // Sentry가 꺼진 debug 빌드에서는 플러그인(webview JS 주입 포함)도 붙이지 않는다.
    if let Some(client) = &sentry_client {
        builder = builder.plugin(tauri_plugin_sentry::init(client));
    }

    let app = builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                configure_main_window(app);
                app_nap::hold();
                poll_clock::start(app.handle().clone());
                // 실패해도 setup을 깨뜨리지 않는다 — 사이드카 없이도 앱은 떠야 한다
                spawn_and_watch_sidecar(app);
            }

            Ok(())
        })
        .build(context)
        .expect("error while running tauri application");

    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            // 사이드카 정리 — 데스크톱 전용 (모바일은 사이드카 없음)
            #[cfg(desktop)]
            {
                // 1. graceful shutdown: /shutdown 엔드포인트로 sidecar 자체 종료 유도 (C1)
                {
                    if let Ok(mut stream) = TcpStream::connect_timeout(
                        &"127.0.0.1:9999".parse().unwrap(),
                        Duration::from_millis(200),
                    ) {
                        // 사이드카가 토큰 검증 중이면 헤더 없이는 401 → graceful shutdown 실패
                        let token = _app.state::<SidecarToken>().0.clone();
                        let request = format!(
                            "POST /shutdown HTTP/1.0\r\nHost: 127.0.0.1\r\nX-Sidecar-Token: {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        );
                        let _ = stream.write_all(request.as_bytes());
                        // sidecar가 /shutdown 후 os._exit(0) — 0.3초면 충분
                        std::thread::sleep(Duration::from_millis(300));
                    }
                }
                // 2. fallback: 부트로더 kill (워치독으로 자식은 이미 죽어 있어야 함)
                if let Some(child) = _app.state::<SidecarChild>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}

#[cfg(all(test, desktop))]
mod sidecar_ready_tests {
    use super::{claim_watcher_generation, is_latest_watcher, is_ready_response};

    #[test]
    fn accepts_only_http_200() {
        assert!(is_ready_response(b"HTTP/1.1 200 OK\r\n"));
        assert!(is_ready_response(b"HTTP/1.0 200 OK\r\n"));
        assert!(!is_ready_response(b"HTTP/1.1 401 Unauthorized\r\n"));
        assert!(!is_ready_response(b""));
        assert!(!is_ready_response(b"HTTP/1.1 200"));
    }

    /// 새 세대가 발급되면 이전 세대 워처는 폴링·emit 자격을 잃는다.
    #[test]
    fn stale_watcher_generation_retires() {
        let stale = claim_watcher_generation();
        assert!(is_latest_watcher(stale));

        let latest = claim_watcher_generation();
        assert!(latest > stale);
        assert!(!is_latest_watcher(stale));
        assert!(is_latest_watcher(latest));
    }
}
