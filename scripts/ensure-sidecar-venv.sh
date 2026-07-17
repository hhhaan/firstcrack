#!/usr/bin/env bash
# Fail fast with setup hint when sidecar .venv is missing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PY="$REPO_ROOT/src-tauri/sidecar/.venv/bin/python"

if [[ -x "$PY" ]]; then
    exit 0
fi

echo "error: sidecar .venv missing (needed for pnpm dev / sidecar)." >&2
echo "  fix:  pnpm setup" >&2
echo "  or:   cd src-tauri/sidecar && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt" >&2
exit 1
