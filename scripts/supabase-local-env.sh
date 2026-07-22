#!/usr/bin/env bash
# Point the app at the local Supabase stack. `rm .env.local` to restore remote.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY)=')"
cat > .env.local <<EOF
VITE_SUPABASE_URL=$API_URL
VITE_SUPABASE_ANON_KEY=$ANON_KEY
EOF
echo "wrote .env.local -> $API_URL (rm .env.local to restore remote)"
