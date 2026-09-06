#!/usr/bin/env bash
# Smoke-test the packaged sidecar: launch, require GET /status 200, kill.
# Usage: scripts/smoke-sidecar.sh <rust-target-triple>
# Runs without SIDECAR_TOKEN → token auth is off (dev mode), so plain curl works.
set -euo pipefail

TARGET="${1:?target triple required}"
BIN="src-tauri/binaries/sidecar-$TARGET"
[[ "$TARGET" == *windows* ]] && BIN="$BIN.exe"
[ -x "$BIN" ] || { echo "::error::sidecar binary missing or not executable: $BIN"; exit 1; }

SIDECAR_DISABLE_SENTRY=1 "$BIN" &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT

# ponytail: 60s covers Windows Defender first-run scan; bump if it flakes
for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:9999/status >/dev/null 2>&1; then
        echo "✅ sidecar smoke OK: $BIN"
        exit 0
    fi
    kill -0 "$PID" 2>/dev/null || { echo "::error::sidecar exited before serving /status: $BIN"; exit 1; }
    sleep 1
done
echo "::error::sidecar did not answer /status within 60s: $BIN"
exit 1
