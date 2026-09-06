# Sidecar startup readiness

## Goal

Fix [#346](https://github.com/hhhaan/firstcrack/issues/346) without changing the sidecar bundle format:

- A sidecar whose Tauri parent died while PyInstaller was loading must never bind port 9999.
- The frontend must not offer machine connection until the current app's sidecar is authenticated and ready.
- A machine-page mount before readiness must recover automatically instead of leaving status `null`.

PyInstaller onedir migration and Sentry ACL cleanup remain separate work.

## Runtime evidence

The instrumented onefile bundle reproduced all relevant paths:

- Cold startup took 17.35 seconds: 9.25 seconds before Python entry and 8.10 seconds from Python entry through frozen imports.
- The first machine-page `/status` failed before bind and had no mount-level retry.
- During rapid relaunch, the old Python child reached bind with `parentAlive: false`, then survived for about one second before the watchdog exited.
- An authenticated request with a different token reached that orphan during the window and received 401.

Therefore a TCP-only readiness probe is insufficient: the stale process can accept TCP while holding the previous app token.

## Design

### A. Reject dead parents before bind

Add a small `main.py` guard called from `__main__` immediately before `web.run_app`:

1. Read `SIDECAR_PARENT_PID`.
2. Preserve dev behavior when it is absent.
3. If it is malformed or `_pid_alive` is false, log the reason and exit successfully before creating the listening socket. Release spawns always provide a valid PID, so an invalid value cannot identify a safe parent.

The existing periodic watchdog remains responsible for parent death after startup.

### B. Emit authenticated readiness

After every successful initial spawn or respawn, Rust starts a readiness task. The task sends a minimal `GET /status` request to port 9999 with the current `SidecarToken`.

- Emit `sidecar-ready` only for HTTP 200.
- Retry connection failures and 401 responses while the spawned sidecar loads.
- A stale sidecar with the previous token cannot produce readiness.
- Duplicate readiness events are harmless; readiness is level-like frontend state.
- Existing `sidecar-dead` behavior is unchanged.

The probe uses the standard library and the existing raw HTTP pattern used for graceful shutdown; no dependency is added.

### C. Recover machine-page status and gate connection

Extract the existing startup retry loop in `src/shared/lib/sidecar.ts` into one internal helper:

- `connect` keeps its current 8-second startup budget.
- A new readiness status operation uses a 30-second budget, covering the measured 17.35-second cold start with headroom.
- Normal polling `getStatus` remains fail-fast so a temporary outage cannot stall every poll for 30 seconds.

`useMachineSidecarConnection` subscribes to `sidecar-ready` and concurrently starts the readiness status operation as a fallback for missed events. Either signal triggers a fresh status read and marks the sidecar ready.

Until ready, the machine connection button is disabled and displays a new localized “Sidecar starting” label. Once ready, existing connect/disconnect behavior resumes unchanged.

## Error handling

- A missing parent PID preserves direct-run development behavior. A malformed or dead parent PID exits before bind.
- A readiness 401 is treated as “not this app's sidecar” and retried, never surfaced to the user.
- If the sidecar exhausts Rust restart attempts, the existing global `sidecar-dead` banner remains the terminal failure signal.
- Readiness listeners are removed on hook cleanup; status retry results are ignored after unmount.

## Verification

Add the smallest checks at the real seams:

1. Python: dead or malformed parent exits before `web.run_app`; absent/live parent continues.
2. Rust: readiness accepts only an HTTP 200 response and rejects 401/connection failure.
3. Frontend: startup retry eventually returns status, and the machine hook exposes not-ready/ready state for button gating.
4. Runtime cold start: immediate machine navigation shows “Sidecar starting,” then enables connection after authenticated readiness without a surfaced Load failed.
5. Runtime rapid relaunch: the old sidecar exits before bind; no 401 is observed; the new sidecar alone emits readiness.

Debug instrumentation remains until both runtime verification scenarios pass.
