#!/usr/bin/env bash
# One-shot local Supabase: boot Docker if needed, start stack, apply pending migrations.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
    [ "$(uname)" = "Darwin" ] || { echo "Docker daemon not running — start it manually"; exit 1; }
    echo "Starting Docker Desktop..."
    open -a Docker
    for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
    docker info >/dev/null 2>&1 || { echo "Docker did not come up in 120s"; exit 1; }
fi

# API responding = stack already up; skip the slow supabase start
if ! curl -s -o /dev/null http://127.0.0.1:54321/rest/v1/; then
    supabase start
fi

supabase migration up
supabase status
