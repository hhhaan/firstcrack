#!/usr/bin/env bash
# Superset workspace bootstrap for fc-desktop.
# Runs in every new worktree: deps + sidecar venv + env symlinks + Tauri external binary.
# Idempotent — safe to re-run. See AGENTS.md (setup) and .superset/config.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Main checkout — source of gitignored artifacts (env files, sidecar binary).
MAIN_WORKTREE="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"

echo "▶ Frontend deps + sidecar venv (pnpm setup)"
pnpm setup
# scripts/setup.sh runs `supabase gen types --linked > database.types.ts`, which
# truncates the committed types to 0 bytes when this worktree isn't supabase-linked.
# Restore it so a fresh workspace never ships broken types.
DB_TYPES="src/shared/types/database.types.ts"
if [[ -f "$DB_TYPES" && ! -s "$DB_TYPES" ]]; then
    git checkout -- "$DB_TYPES"
    echo "  restored $DB_TYPES (types:gen needs supabase link)"
fi

echo "▶ Env files (symlinked from main checkout)"
# .env, .env.development, .env.production are gitignored, so a fresh worktree has
# none. Symlink them from the main checkout so they stay in sync (copy fallback).
for f in .env .env.development .env.production; do
    if [[ -e "$REPO_ROOT/$f" ]]; then
        echo "  exists: $f"
    elif [[ -f "$MAIN_WORKTREE/$f" ]]; then
        if ln -sfn "$MAIN_WORKTREE/$f" "$REPO_ROOT/$f"; then
            echo "  linked: $f"
        else
            cp "$MAIN_WORKTREE/$f" "$REPO_ROOT/$f"
            echo "  copied: $f (symlink unavailable)"
        fi
    else
        echo "  skip: $f (not in main checkout)" >&2
    fi
done

echo "▶ Tauri external sidecar binary"
# src-tauri/binaries/sidecar-* is gitignored, but tauri.macos.conf.json declares
# externalBin: ["binaries/sidecar"], so `pnpm tauri dev` fails without it.
# Dev runs the venv sidecar (see package.json "dev"), so the binary only needs to
# exist for the Tauri build — copy the one already built in the main checkout.
TARGET="$(rustc --print host-target 2>/dev/null || python3 -c '
import platform
m = platform.machine()
s = platform.system()
if s == "Darwin":
    print("aarch64-apple-darwin" if m == "arm64" else "x86_64-apple-darwin")
elif s == "Windows":
    print("x86_64-pc-windows-msvc")
else:
    print("x86_64-unknown-linux-gnu")
')"
DEST="$REPO_ROOT/src-tauri/binaries/sidecar-$TARGET"

if [[ -f "$DEST" ]]; then
    echo "  exists: $(basename "$DEST")"
else
    SRC="$MAIN_WORKTREE/src-tauri/binaries/sidecar-$TARGET"
    if [[ -f "$SRC" ]]; then
        mkdir -p "$REPO_ROOT/src-tauri/binaries"
        cp "$SRC" "$DEST"
        echo "  copied from main checkout"
    else
        echo "  warn: sidecar binary missing and not found in main checkout." >&2
        echo "        build it with: pnpm build:sidecar  (needs pyinstaller)" >&2
    fi
fi

echo ""
echo "✅ workspace ready"
echo "  desktop:  pnpm tauri dev"
echo "  web-only: pnpm dev"
