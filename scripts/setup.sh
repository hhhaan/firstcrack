#!/usr/bin/env bash
# Local bootstrap: frontend deps + sidecar venv (+ optional Supabase types).
# Usage: pnpm setup   |   bash scripts/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SIDECAR_DIR="$REPO_ROOT/src-tauri/sidecar"

cd "$REPO_ROOT"

echo "▶ Frontend (pnpm install)"
if ! command -v pnpm &>/dev/null; then
    echo "error: pnpm not found. Enable via: corepack enable && corepack prepare pnpm@11.3.0 --activate" >&2
    exit 1
fi
pnpm install

echo "▶ Sidecar Python venv"
if ! command -v python3 &>/dev/null; then
    echo "error: python3 not found" >&2
    exit 1
fi

if [[ ! -x "$SIDECAR_DIR/.venv/bin/python" ]]; then
    python3 -m venv "$SIDECAR_DIR/.venv"
    echo "  created $SIDECAR_DIR/.venv"
else
    echo "  .venv already exists"
fi

# shellcheck disable=SC1091
source "$SIDECAR_DIR/.venv/bin/activate"
pip install --upgrade pip -q
pip install -r "$SIDECAR_DIR/requirements-dev.txt" -q
echo "  installed requirements-dev.txt"

echo "▶ Supabase types (optional — needs linked project)"
if command -v supabase &>/dev/null; then
    if pnpm types:gen; then
        echo "  database.types.ts updated"
    else
        echo "  warn: types:gen failed (run after: supabase link / scripts/setup-supabase.sh)"
    fi
else
    echo "  skip: supabase CLI not installed"
fi

echo ""
echo "✅ setup complete"
echo "  web-only:  pnpm dev"
echo "  desktop:   pnpm tauri dev"
echo "  verify:    pnpm verify:all"
