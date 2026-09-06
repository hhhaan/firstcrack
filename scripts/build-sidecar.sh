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

# onedir folder → src-tauri/binaries/sidecar (Tauri bundle.resources target)
mkdir -p "$BINARIES_DIR"
SRC="$SIDECAR_DIR/dist/sidecar"
DEST="$BINARIES_DIR/sidecar"

if [ ! -d "$SRC" ]; then
    echo "❌ expected onedir folder at $SRC (sidecar.spec must use COLLECT)"
    exit 1
fi

rm -rf "$DEST"
cp -R "$SRC" "$DEST"
# keep the tracked placeholder so a clean tree still has the resource dir
touch "$DEST/.gitkeep"

if [[ "$TARGET" == *"windows"* ]]; then
    [ -f "$DEST/sidecar.exe" ] || { echo "❌ missing $DEST/sidecar.exe"; exit 1; }
else
    chmod +x "$DEST/sidecar"
    [ -x "$DEST/sidecar" ] || { echo "❌ missing executable $DEST/sidecar"; exit 1; }
fi

echo "✅ sidecar onedir → $DEST ($TARGET)"
