use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

struct SidecarChild(Mutex<Option<CommandChild>>);

/// 사이드카 자동 재시작 백오프 (초). 길이 = 최대 시도 횟수.
const RESTART_BACKOFFS_SECS: [u64; 3] = [2, 5, 10];

#[tauri::command]
fn save_pdf(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}


/// 포트 9999를 점유한 프로세스가 우리 사이드카 바이너리인지 확인 후 kill.
/// 정상 twin이 없다고 single-instance 플러그인이 이미 보장한 상태에서만 호출된다.
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
                    if name.contains("sidecar") || name.contains("python") {
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
                    if name.contains("sidecar") || name.contains("python") {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/PID", &pid])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        eprintln!("[sidecar-guard] Windows 좀비 사이드카 kill: PID {pid}");
                    }
                }
            }
        }
    }
}

/// 사이드카가 이미 살아있는지 헬스체크.
/// TCP connect만으로는 listen만 하고 응답 못 하는 좀비를 잡지 못하므로
/// GET /status 응답까지 확인한다. 200 OK 라인을 받으면 healthy.
fn sidecar_healthy() -> bool {
    use std::io::{Read, Write};
    use std::time::Duration;

    let mut stream = match std::net::TcpStream::connect_timeout(
        &"127.0.0.1:9999".parse().unwrap(),
        Duration::from_millis(300),
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));

    if stream
        .write_all(b"GET /status HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    // 16바이트면 "HTTP/1.X 200 OK\r" 전체를 수신하기에 충분하다.
    // windows(3)으로 "200" substring을 찾는 것이 naive해 보이지만,
    // 응답 시작 16바이트 안에는 HTTP 버전 + 상태코드만 존재하므로 오탐 없음.
    let mut buf = [0u8; 16];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };
    let prefix = &buf[..n];
    prefix.starts_with(b"HTTP/1.") && prefix.windows(3).any(|w| w == b"200")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = sentry::Client::from((
        "https://a7ad70395dfd0d01e1a94e04fdf4e0e1@o4511400846884864.ingest.us.sentry.io/4511400857042944",
        sentry::ClientOptions {
            release: sentry::release_name!(),
            ..Default::default()
        },
    ));
    sentry::Hub::main().bind_client(Some(std::sync::Arc::new(client.clone())));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_sentry::init(&client))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 두 번째 실행 시 기존 창을 앞으로 가져옴
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        // CommandChild has no Drop impl — storing via manage() keeps it alive for the app lifetime.
        .manage(SidecarChild(Mutex::new(None)))
        .setup(|app| {
            // Single-instance 플러그인이 twin 없음을 보장한 이후이므로,
            // 포트를 점유한 프로세스는 이전 크래시의 좀비다.
            if sidecar_healthy() {
                eprintln!("[sidecar-guard] 포트 9999 응답 감지 → 좀비 정리");
                kill_zombie_sidecar();
                std::thread::sleep(std::time::Duration::from_millis(200));
            }

            let sidecar_command = app.shell().sidecar("sidecar")?;
            let (rx, child) = sidecar_command.spawn()?;
            *app.state::<SidecarChild>().0.lock().unwrap() = Some(child);

            // stdout/stderr 드레인 + Terminated 감지 시 백오프 재시작.
            // RESTART_BACKOFFS_SECS만큼 시도, 성공하면 카운터 리셋.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut current_rx = rx;
                let mut attempts: usize = 0;

                loop {
                    while let Some(event) = current_rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                print!("[sidecar] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                eprint!("[sidecar] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Terminated(payload) => {
                                eprintln!("[sidecar] terminated: code={:?}", payload.code);
                                break;
                            }
                            _ => {}
                        }
                    }

                    if attempts >= RESTART_BACKOFFS_SECS.len() {
                        eprintln!(
                            "[sidecar-restart] {}회 재시작 모두 실패 — 사이드카 복구 포기",
                            RESTART_BACKOFFS_SECS.len()
                        );
                        // TODO: 프론트엔드에 "사이드카 복구 실패, 앱 재시작 필요" 토스트 emit.
                        //       app_handle.emit("sidecar-dead", ()) 등으로 알림 후 UI에서 처리.
                        break;
                    }

                    let delay = RESTART_BACKOFFS_SECS[attempts];
                    eprintln!(
                        "[sidecar-restart] {}초 후 재시작 ({}/{})",
                        delay,
                        attempts + 1,
                        RESTART_BACKOFFS_SECS.len()
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;

                    // 재시작 직전에도 좀비 가드 — 죽은 프로세스가 포트를 잡고 있는 케이스
                    if sidecar_healthy() {
                        eprintln!("[sidecar-restart] 포트 9999 응답 감지 → 좀비 정리");
                        kill_zombie_sidecar();
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }

                    let respawn = app_handle
                        .shell()
                        .sidecar("sidecar")
                        .and_then(|cmd| cmd.spawn().map_err(Into::into));

                    match respawn {
                        Ok((new_rx, new_child)) => {
                            *app_handle.state::<SidecarChild>().0.lock().unwrap() = Some(new_child);
                            current_rx = new_rx;
                            attempts = 0;
                            eprintln!("[sidecar-restart] 재시작 성공");
                        }
                        Err(e) => {
                            attempts += 1;
                            eprintln!("[sidecar-restart] spawn 실패: {e}");
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_pdf, print_window])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // 정상 종료 시 사이드카를 명시적으로 kill해 포트를 즉시 해제
            if let Some(child) = app.state::<SidecarChild>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
