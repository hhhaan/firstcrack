#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SIDECAR_DIR="$REPO_ROOT/src-tauri/sidecar"
BINARIES_DIR="$REPO_ROOT/src-tauri/binaries"

# Resolve Rust target triple for the current machine
TARGET=$(rustc --print host-target 2>/dev/null || python3 -c "
import platform
m = platform.machine()
s = platform.system()
if s == 'Darwin':
    print('aarch64-apple-darwin' if m == 'arm64' else 'x86_64-apple-darwin')
elif s == 'Windows':
    print('x86_64-pc-windows-msvc')
else:
    print('x86_64-unknown-linux-gnu')
")

echo "▶ Building sidecar for target: $TARGET"

# PyInstaller — venv 우선, 없으면 PATH (CI: pip install pyinstaller 후 사용)
cd "$SIDECAR_DIR"
PYINSTALLER="$SIDECAR_DIR/.venv/bin/pyinstaller"
if [ ! -f "$PYINSTALLER" ]; then
    PYINSTALLER="$SIDECAR_DIR/venv/bin/pyinstaller"
fi
if [ ! -f "$PYINSTALLER" ]; then
    PYINSTALLER=$(command -v pyinstaller 2>/dev/null || true)
fi
if [ -z "$PYINSTALLER" ]; then
    echo "❌ PyInstaller not found. Run: cd src-tauri/sidecar && python -m venv .venv && .venv/bin/pip install pyinstaller -r requirements.txt"
    exit 1
fi

"$PYINSTALLER" sidecar.spec --distpath "$SIDECAR_DIR/dist" --workpath "$SIDECAR_DIR/build" --noconfirm

# Copy binary to src-tauri/binaries/ with Tauri-expected name
mkdir -p "$BINARIES_DIR"
SRC="$SIDECAR_DIR/dist/sidecar"
DEST="$BINARIES_DIR/sidecar-$TARGET"

if [[ "$TARGET" == *"windows"* ]]; then
    SRC="$SRC.exe"
    DEST="$DEST.exe"
fi

cp "$SRC" "$DEST"
echo "✅ sidecar binary → $DEST"
