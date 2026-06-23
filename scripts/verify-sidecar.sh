#!/usr/bin/env bash
set -euo pipefail

SIDECAR_DIR="$(cd "$(dirname "$0")/../src-tauri/sidecar" && pwd)"
cd "$SIDECAR_DIR"

if [[ -x .venv/bin/python ]]; then
    .venv/bin/python -m pytest tests/ -q
    exit 0
fi

echo "error: sidecar .venv missing."
echo "  cd src-tauri/sidecar"
echo "  python3 -m venv .venv"
echo "  .venv/bin/pip install -r requirements-dev.txt"
exit 1
