# Sidecar Startup Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale sidecars from binding after relaunch and keep machine connection disabled until the current app's sidecar answers an authenticated readiness probe.

**Architecture:** Python rejects a dead Tauri parent immediately before bind. Rust probes `/status` with the current process token and emits `sidecar-ready` only after HTTP 200. The machine feature combines that event with a bounded status retry fallback and exposes readiness to the existing button.

**Tech Stack:** Python 3.11/aiohttp, Rust/Tauri 2 standard library events, React 19, TypeScript, Vitest, pytest.

## Global Constraints

- Implement only issue items A, B, and C; PyInstaller onedir and Sentry ACL work remain out of scope.
- Add no dependency.
- TCP acceptance alone is not readiness; only authenticated HTTP 200 is ready.
- Keep normal `getStatus` fail-fast, readiness status retry at 30 seconds, and `connect` retry at 8 seconds.
- Keep all existing `agent log` instrumentation and the temporary CSP port 7587 allowance until post-fix runtime logs pass.
- Preserve FSD direction; `views` consumes readiness returned by `features/machine-connection`.
- Use `git add <task files> && bash scripts/ai-commit.sh`; never use `git commit -m`.

---

### Task 1: Reject a dead sidecar parent before bind

**Files:**
- Modify: `src-tauri/sidecar/main.py`
- Test: `src-tauri/sidecar/tests/test_watchdog.py`

**Interfaces:**
- Consumes: existing `_pid_alive(pid: int) -> bool`
- Produces: `_exit_if_parent_dead() -> None`, called before `web.run_app`

- [ ] **Step 1: Write failing parent-guard tests**

Append to `src-tauri/sidecar/tests/test_watchdog.py`:

```python
class TestExitIfParentDead:
    def test_absent_parent_pid_allows_direct_dev_run(self, monkeypatch):
        from main import _exit_if_parent_dead

        monkeypatch.delenv("SIDECAR_PARENT_PID", raising=False)
        _exit_if_parent_dead()

    def test_live_parent_allows_bind(self, monkeypatch):
        from main import _exit_if_parent_dead

        monkeypatch.setenv("SIDECAR_PARENT_PID", str(os.getpid()))
        with mock.patch("main._pid_alive", return_value=True):
            _exit_if_parent_dead()

    @pytest.mark.parametrize("parent_pid", ["invalid", "999999999"])
    def test_invalid_or_dead_parent_exits_before_bind(self, monkeypatch, parent_pid):
        from main import _exit_if_parent_dead

        monkeypatch.setenv("SIDECAR_PARENT_PID", parent_pid)
        with mock.patch("main._pid_alive", return_value=False):
            with pytest.raises(SystemExit) as exc:
                _exit_if_parent_dead()
        assert exc.value.code == 0
```

- [ ] **Step 2: Run the tests and verify red**

Run:

```bash
cd src-tauri/sidecar
.venv/bin/pytest tests/test_watchdog.py::TestExitIfParentDead -q
```

Expected: collection or import failure because `_exit_if_parent_dead` does not exist.

- [ ] **Step 3: Implement the pre-bind guard**

Add after `_pid_alive` in `main.py`:

```python
def _exit_if_parent_dead() -> None:
    pid_str = os.environ.get("SIDECAR_PARENT_PID")
    if pid_str is None:
        return
    try:
        parent_pid = int(pid_str)
    except ValueError:
        _log.error("잘못된 부모 PID — sidecar bind 취소")
        raise SystemExit(0)
    if not _pid_alive(parent_pid):
        _log.info("부모 프로세스(PID %d) 사망 — sidecar bind 취소", parent_pid)
        # region agent log
        with open("/Users/hanseungheon/han/first-crack-proj/fc-desktop/.cursor/debug-c9b355.log", "a", encoding="utf-8") as f:
            f.write(json.dumps({"sessionId": "c9b355", "runId": "post-fix", "hypothesisId": "H2", "location": "src-tauri/sidecar/main.py:_exit_if_parent_dead", "message": "Rejected dead parent before bind", "data": {"pid": os.getpid(), "ppid": os.getppid(), "declaredParentPid": parent_pid}, "timestamp": int(time.time() * 1000)}) + "\n")
        # endregion
        raise SystemExit(0)
```

Call it before the existing “Sidecar about to bind” instrumentation:

```python
if __name__ == "__main__":
    _exit_if_parent_dead()
    # existing instrumentation remains here
    _log.info("First Crack sidecar 시작 — http://127.0.0.1:9999")
    web.run_app(create_app(), host="127.0.0.1", port=9999, print=None)
```

- [ ] **Step 4: Run focused and full sidecar tests**

Run:

```bash
cd src-tauri/sidecar
.venv/bin/pytest tests/test_watchdog.py::TestExitIfParentDead -q
cd ../..
pnpm verify:sidecar
```

Expected: focused tests pass; full sidecar suite passes.

- [ ] **Step 5: Commit Task 1**

```bash
git add src-tauri/sidecar/main.py src-tauri/sidecar/tests/test_watchdog.py
bash scripts/ai-commit.sh
```

---

### Task 2: Emit readiness only for the current authenticated sidecar

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `SidecarToken`, `tauri::Emitter`, `127.0.0.1:9999`
- Produces: `is_ready_response(&[u8]) -> bool`, `probe_sidecar_ready(&str) -> bool`, `watch_sidecar_ready(AppHandle) -> ()`, event `sidecar-ready`

- [ ] **Step 1: Write failing Rust response-classification tests**

Add a desktop-gated test module at the end of `src-tauri/src/lib.rs`:

```rust
#[cfg(all(test, desktop))]
mod sidecar_ready_tests {
    use super::is_ready_response;

    #[test]
    fn accepts_only_http_200() {
        assert!(is_ready_response(b"HTTP/1.1 200 OK\r\n"));
        assert!(is_ready_response(b"HTTP/1.0 200 OK\r\n"));
        assert!(!is_ready_response(b"HTTP/1.1 401 Unauthorized\r\n"));
        assert!(!is_ready_response(b""));
    }
}
```

- [ ] **Step 2: Run the Rust test and verify red**

Run:

```bash
cd src-tauri
cargo test sidecar_ready_tests::accepts_only_http_200
```

Expected: compile failure because `is_ready_response` does not exist.

- [ ] **Step 3: Implement the authenticated probe**

Add desktop imports:

```rust
#[cfg(desktop)]
use std::io::{Read, Write};
#[cfg(desktop)]
use std::net::TcpStream;
#[cfg(desktop)]
use std::time::Duration;
```

Add beside `sidecar_token`:

```rust
#[cfg(desktop)]
fn is_ready_response(response: &[u8]) -> bool {
    response.starts_with(b"HTTP/1.1 200 ") || response.starts_with(b"HTTP/1.0 200 ")
}

#[cfg(desktop)]
fn probe_sidecar_ready(token: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:9999".parse().unwrap(),
        Duration::from_millis(200),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
    let request = format!(
        "GET /status HTTP/1.0\r\nHost: 127.0.0.1\r\nX-Sidecar-Token: {token}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = [0_u8; 32];
    match stream.read(&mut response) {
        Ok(size) => is_ready_response(&response[..size]),
        Err(_) => false,
    }
}

#[cfg(desktop)]
fn watch_sidecar_ready(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let token = app.state::<SidecarToken>().0.clone();
        loop {
            if probe_sidecar_ready(&token) {
                let _ = app.emit("sidecar-ready", ());
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}
```

Use the existing imported `Write` and `Duration` in the exit handler instead of its local imports.

- [ ] **Step 4: Start a readiness watcher after every successful spawn**

In the initial spawn success arm, after storing `child`:

```rust
watch_sidecar_ready(app_handle.clone());
```

In the respawn success arm, after storing `new_child`:

```rust
watch_sidecar_ready(app_handle.clone());
```

Do not emit readiness from a plain TCP connection.

- [ ] **Step 5: Run Rust tests and checks**

Run:

```bash
cd src-tauri
cargo test sidecar_ready_tests::accepts_only_http_200
cargo test
cargo fmt --check
```

Expected: all tests pass and formatting reports no diff.

- [ ] **Step 6: Commit Task 2**

```bash
git add src-tauri/src/lib.rs
bash scripts/ai-commit.sh
```

---

### Task 3: Share startup retry and add a readiness status operation

**Files:**
- Create: `src/shared/lib/sidecar.test.ts`
- Modify: `src/shared/lib/sidecar.ts`

**Interfaces:**
- Consumes: `isSidecarStartingError`, existing `request<T>`
- Produces: `sidecar.waitUntilReady() -> Promise<SidecarStatus>`

- [ ] **Step 1: Write a failing retry test**

Create `src/shared/lib/sidecar.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockResolvedValue('test-token'),
}));

import { sidecar } from './sidecar';

describe('sidecar.waitUntilReady', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('retries startup failures and returns the first healthy status', async () => {
        let sidecarCalls = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string | URL | Request) => {
                const url = String(input);
                if (url.includes(':7587/ingest/')) return Promise.resolve(new Response(null, { status: 204 }));
                sidecarCalls += 1;
                if (sidecarCalls === 1) return Promise.reject(new TypeError('Load failed'));
                return Promise.resolve(
                    new Response(JSON.stringify({ connected: false, roaster: null, error: null }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }),
                );
            }),
        );

        const pending = sidecar.waitUntilReady();
        await vi.advanceTimersByTimeAsync(400);

        await expect(pending).resolves.toMatchObject({ connected: false });
        expect(sidecarCalls).toBe(2);
    });
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
pnpm vitest run src/shared/lib/sidecar.test.ts
```

Expected: failure because `waitUntilReady` does not exist.

- [ ] **Step 3: Extract the retry helper and expose readiness**

In `src/shared/lib/sidecar.ts`, replace the connect-specific loop with:

```typescript
const STARTUP_RETRY_GAP_MS = 400;
const CONNECT_RETRY_BUDGET_MS = 8_000;
const READY_RETRY_BUDGET_MS = 30_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function retryWhileSidecarStarts<T>(operation: () => Promise<T>, budgetMs: number): Promise<T> {
    const deadline = Date.now() + budgetMs;
    for (;;) {
        try {
            return await operation();
        } catch (error) {
            if (!isSidecarStartingError(error) || Date.now() >= deadline) throw error;
            await wait(STARTUP_RETRY_GAP_MS);
        }
    }
}
```

Add to `sidecar`:

```typescript
waitUntilReady: () => retryWhileSidecarStarts(() => request<SidecarStatus>('/status'), READY_RETRY_BUDGET_MS),
```

Implement `connect` with the same helper:

```typescript
connect: (roasterKey: string, params: Record<string, unknown>) =>
    retryWhileSidecarStarts(
        () =>
            request<SidecarStatus>(
                '/connect',
                {
                    method: 'POST',
                    body: JSON.stringify({ roaster: roasterKey, ...params }),
                },
                CONNECT_TIMEOUT_MS,
            ),
        CONNECT_RETRY_BUDGET_MS,
    ),
```

Keep all existing fetch instrumentation unchanged.

- [ ] **Step 4: Run focused frontend verification**

Run:

```bash
pnpm vitest run src/shared/lib/sidecar.test.ts src/shared/lib/errorMessage.test.ts
pnpm typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/shared/lib/sidecar.ts src/shared/lib/sidecar.test.ts
bash scripts/ai-commit.sh
```

---

### Task 4: Gate machine connection on readiness

**Files:**
- Modify: `src/features/machine-connection/model/useMachineSidecarConnection.ts`
- Modify: `src/features/machine-connection/model/useMachineSidecarConnection.test.ts`
- Modify: `src/views/machines/Machines.tsx`
- Modify: `src/shared/i18n/locales/en.json`
- Modify: `src/shared/i18n/locales/ko.json`
- Modify: `src/shared/i18n/locales/ja.json`
- Modify: `src/shared/i18n/locales/zh-CN.json`

**Interfaces:**
- Consumes: event `sidecar-ready`, `sidecar.waitUntilReady()`
- Produces: hook field `sidecarReady: boolean`

- [ ] **Step 1: Add failing source-contract assertions**

Extend `useMachineSidecarConnection.test.ts`:

```typescript
it('waits for authenticated sidecar readiness', () => {
    expect(hookSrc).toContain("listen<null>('sidecar-ready'");
    expect(hookSrc).toContain('sidecar.waitUntilReady()');
    expect(hookSrc).toContain('sidecarReady');
    expect(machinesSrc).toMatch(/disabled=\\{connecting \\|\\| !sidecarReady\\}/);
    expect(machinesSrc).toContain("t('machines.sidecarStarting')");
});
```

- [ ] **Step 2: Run the feature test and verify red**

Run:

```bash
pnpm vitest run src/features/machine-connection/model/useMachineSidecarConnection.test.ts
```

Expected: new assertions fail.

- [ ] **Step 3: Implement readiness state and event/fallback convergence**

Import `listen` from `@tauri-apps/api/event`. Add:

```typescript
const [sidecarReady, setSidecarReady] = useState(false);
```

Replace the one-shot mount status effect with:

```typescript
useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const markReady = (status?: SidecarStatus) => {
        if (cancelled) return;
        if (status) setSidecarStatus(status);
        setSidecarReady(true);
    };

    void listen<null>('sidecar-ready', () => {
        void sidecar.getStatus().then(markReady).catch(() => null);
    }).then((fn) => {
        unlisten = fn;
    });

    if (!modalOpen) {
        void sidecar.waitUntilReady().then(markReady).catch(() => null);
    }

    return () => {
        cancelled = true;
        unlisten?.();
    };
}, [isActive, modalOpen]);
```

Add a temporary post-fix `agent log` fetch inside the event callback to record `message: "Frontend received sidecar-ready"` with `runId: "post-fix"` and `hypothesisId: "H1,H3,H4"`.

Return `sidecarReady` from the hook.

- [ ] **Step 4: Disable and relabel the connection button**

Destructure `sidecarReady` in `Machines.tsx`. Change only the button state expressions:

```tsx
disabled={connecting || !sidecarReady}
```

Use readiness before connecting for the label and inactive styling:

```tsx
className={`flex-1 py-3 rounded-lg border-none bg-primary dark:bg-[#0d0d0d] text-white text-sm font-medium flex items-center justify-center gap-2 ${
    connecting || !sidecarReady ? 'opacity-70 cursor-default' : 'cursor-pointer'
}`}
```

```tsx
{!sidecarReady ? (
    <>
        <Activity size={15} /> {t('machines.sidecarStarting')}
    </>
) : connecting ? (
    <>
        <Activity size={15} /> {t('common.connecting')}
    </>
) : (
    <>
        <Wifi size={15} strokeWidth={2} /> {t('machines.connect')}
    </>
)}
```

- [ ] **Step 5: Add all locale strings**

Add `sidecarStarting` beside `machines.connect`:

```json
// en.json
"sidecarStarting": "Sidecar starting...",

// ko.json
"sidecarStarting": "사이드카 시작 중...",

// ja.json
"sidecarStarting": "サイドカーを起動中...",

// zh-CN.json
"sidecarStarting": "正在启动边车服务...",
```

- [ ] **Step 6: Run focused and static verification**

Run:

```bash
pnpm vitest run src/features/machine-connection/model/useMachineSidecarConnection.test.ts src/shared/lib/sidecar.test.ts
pnpm check:i18n
pnpm typecheck
pnpm check
```

Expected: all commands pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/features/machine-connection/model/useMachineSidecarConnection.ts \
  src/features/machine-connection/model/useMachineSidecarConnection.test.ts \
  src/views/machines/Machines.tsx \
  src/shared/i18n/locales/en.json \
  src/shared/i18n/locales/ko.json \
  src/shared/i18n/locales/ja.json \
  src/shared/i18n/locales/zh-CN.json
bash scripts/ai-commit.sh
```

---

### Task 5: Prove the fix end-to-end, then remove instrumentation

**Files:**
- Modify after successful verification: `src-tauri/sidecar/main.py`
- Modify after successful verification: `src/shared/lib/sidecar.ts`
- Modify after successful verification: `src/features/machine-connection/model/useMachineSidecarConnection.ts`
- Modify after successful verification: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: debug log `.cursor/debug-c9b355.log`
- Produces: clean production code with no debug endpoint or session instrumentation

- [ ] **Step 1: Build the instrumented debug app**

Run:

```bash
pnpm build:sidecar
pnpm tauri build --debug --bundles app
```

Expected: the `.app` bundle is produced. A final updater-signing error is acceptable locally only if it occurs after the app bundle is listed as finished.

- [ ] **Step 2: Clear only this debug session log**

Use the file deletion tool on:

```text
/Users/hanseungheon/han/first-crack-proj/fc-desktop/.cursor/debug-c9b355.log
```

Do not use `rm`, `touch`, or truncate another session's file.

- [ ] **Step 3: Verify cold startup**

Run the bundle's `Contents/MacOS/roastery-agent` executable directly so LaunchServices cannot redirect to `/Applications/First Crack.app`.

Immediately open Machines. Expected UI and logs:

- The button reads “사이드카 시작 중...” and is disabled before readiness.
- No user-facing Load failed or unauthorized error appears.
- Python entry/import/bind logs occur.
- `Frontend received sidecar-ready` occurs only after authenticated `/status` 200.
- The button becomes enabled.

- [ ] **Step 4: Clear the session log again with the deletion tool**

Delete only `.cursor/debug-c9b355.log` before the rapid-relaunch run.

- [ ] **Step 5: Verify rapid relaunch**

Start the debug executable, terminate the Tauri parent within one second, and immediately start it again.

Expected logs:

- The old process records `Rejected dead parent before bind`.
- The old PID never records `Sidecar about to bind`.
- No `Sidecar rejected token` entry occurs.
- Only the new process reaches bind and the frontend receives readiness after HTTP 200.

- [ ] **Step 6: Wait for user confirmation**

Do not remove instrumentation until the user confirms both UI scenarios have no remaining issue and the post-fix log assertions above hold.

- [ ] **Step 7: Remove all session instrumentation**

After confirmation:

- Remove every `#region agent log` / `#endregion` block added for session `c9b355`.
- Restore `import os` and `import time` in the normal post-Sentry import block in `main.py`; remove the debug-only `import json`.
- Remove the temporary frontend readiness event log.
- Remove `http://127.0.0.1:7587` from `src-tauri/tauri.conf.json`.
- Keep the functional guard, authenticated readiness probe/event, retry helper, readiness state, UI copy, and tests.

Verify no session marker remains:

```bash
rg 'c9b355|0bb0b05a-64a9-4b7c-808f-af9b5ec0a764|127\\.0\\.0\\.1:7587|agent log' src src-tauri
```

Expected: no matches.

- [ ] **Step 8: Run final verification**

Run:

```bash
pnpm verify:all
```

Expected: all checks pass.

- [ ] **Step 9: Commit cleanup and verified fix**

```bash
git add src-tauri/sidecar/main.py \
  src-tauri/tauri.conf.json \
  src/shared/lib/sidecar.ts \
  src/features/machine-connection/model/useMachineSidecarConnection.ts
bash scripts/ai-commit.sh
```
