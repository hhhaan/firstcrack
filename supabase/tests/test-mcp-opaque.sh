#!/usr/bin/env bash
# Disposable fixture only. Does not use the linked Supabase project or change hosted settings.
set -euo pipefail
cd "$(dirname "$0")/../.."
landing_root=$(cd "${MCP_TEST_LANDING_ROOT:-../fc-landing}" && pwd)
docker_cmd=(docker)
if [[ -n "${MCP_TEST_DOCKER_HOST:-}" ]]; then
    docker_cmd=(env -u DOCKER_CONTEXT -u DOCKER_HOST -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host "$MCP_TEST_DOCKER_HOST")
fi
container="fc-mcp-fixture-${RANDOM}-$$"
trap '"${docker_cmd[@]}" rm -f "$container" >/dev/null 2>&1 || true' EXIT
"${docker_cmd[@]}" run --rm -d --name "$container" -p 127.0.0.1::5432 \
    -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
ready=false
for _ in {1..30}; do
    if "${docker_cmd[@]}" exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
done
[[ "$ready" == true ]] || { echo 'Fixture PostgreSQL failed to start' >&2; exit 1; }
"${docker_cmd[@]}" exec "$container" mkdir -p /tmp/mcp/tests /tmp/mcp/migrations
"${docker_cmd[@]}" cp supabase/tests/mcp-opaque-fixture.sql "$container:/tmp/mcp/tests/fixture.sql"
"${docker_cmd[@]}" cp supabase/migrations/20261026120000_firstcrack_mcp_read_issuer.sql "$container:/tmp/mcp/migrations/20261026120000_firstcrack_mcp_read_issuer.sql"
"${docker_cmd[@]}" exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -f /tmp/mcp/tests/fixture.sql >/dev/null
port=$("${docker_cmd[@]}" inspect -f '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$container")
pnpm --config.verify-deps-before-run=false dlx deno@2.9.6 run -A --no-lock --node-modules-dir=none \
    supabase/tests/mcp-opaque.integration.ts "$port" "$landing_root"
