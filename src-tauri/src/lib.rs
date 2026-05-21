use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

struct SidecarChild(Mutex<Option<CommandChild>>);

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
        // lsof로 PID를 구한 뒤 프로세스 이름이 "sidecar"를 포함할 때만 kill
        let pid_output = std::process::Command::new("sh")
            .args(["-c", "lsof -ti tcp:9999 2>/dev/null"])
            .output();

        if let Ok(out) = pid_output {
            let pids = String::from_utf8_lossy(&out.stdout);
            for pid_str in pids.split_whitespace() {
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
        // netstat으로 PID를 찾아 taskkill
        let _ = std::process::Command::new("cmd")
            .args(["/C", "for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :9999') do taskkill /F /PID %a 2>nul"])
            .output();
    }
}

/// 사이드카가 이미 살아있는지 헬스체크 (500ms 타임아웃).
/// 정상 응답이면 true — 이 경우 kill하지 않는다.
fn sidecar_healthy() -> bool {
    use std::time::Duration;
    // 동기 TCP 연결 시도로 포트 활성 여부만 확인
    std::net::TcpStream::connect_timeout(
        &"127.0.0.1:9999".parse().unwrap(),
        Duration::from_millis(300),
    )
    .is_ok()
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
            let (mut rx, child) = sidecar_command.spawn()?;
            *app.state::<SidecarChild>().0.lock().unwrap() = Some(child);

            // sidecar stdout/stderr를 드레인해서 버퍼 블로킹 방지
            tauri::async_runtime::spawn(async move {
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
                            break;
                        }
                        _ => {}
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
