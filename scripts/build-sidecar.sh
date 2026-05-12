#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$ROOT/src-tauri/sidecar"
OUT="$ROOT/src-tauri/binaries/sidecar-aarch64-apple-darwin"

echo "▶ Building Python sidecar..."
cd "$SIDECAR_DIR"

.venv/bin/pyinstaller sidecar.spec \
    --distpath /tmp/fc-sidecar-dist \
    --workpath /tmp/fc-sidecar-build \
    --noconfirm \
    --clean

mv /tmp/fc-sidecar-dist/sidecar "$OUT"
echo "✓ $OUT"
