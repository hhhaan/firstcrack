#!/usr/bin/env bash
set -euo pipefail

# One-liner Supabase local dev setup.
# 1. Install/verify supabase CLI
# 2. Login (if not already)
# 3. Link project
# 4. Start local stack
# 5. Generate types

PROJECT_REF="vjdgdolfxvnxushxrmff"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "▶ Checking Supabase CLI..."
if ! command -v supabase &>/dev/null; then
    if command -v brew &>/dev/null; then
        echo "Installing supabase CLI via Homebrew..."
        brew install supabase/tap/supabase
    else
        echo "Installing supabase CLI via npm..."
        npm install -g supabase
    fi
fi

SUPABASE_VERSION=$(supabase --version)
echo "  CLI: $SUPABASE_VERSION"

echo "▶ Checking login status..."
if ! supabase projects list &>/dev/null; then
    echo "  Not logged in — run: supabase login"
    supabase login
fi

echo "▶ Linking project ($PROJECT_REF)..."
if ! supabase link --project-ref "$PROJECT_REF"; then
    echo "❌ Failed to link project $PROJECT_REF"
    exit 1
fi

echo "▶ Starting local Supabase stack..."
if ! supabase start; then
    if supabase status &>/dev/null; then
        echo "  Already running"
    else
        echo "❌ Failed to start local Supabase stack (is Docker running?)"
        exit 1
    fi
fi

echo "▶ Generating TypeScript types..."
pnpm types:gen

echo ""
echo "✅ Supabase dev environment ready."
echo "   Local API:  http://localhost:54321"
echo "   Studio:     http://localhost:54323"
echo "   Run 'supabase stop' to shut down."
