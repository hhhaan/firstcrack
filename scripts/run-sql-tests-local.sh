#!/usr/bin/env bash
# Bootstrap: Supabase Postgres 15 image + trimmed remote baseline + migrations from 20260905,
# then 20260802000002_ef_batch_stock_guards.sql (jsonb insert_product_stock_events_batch).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="${1:-11111111-1111-1111-1111-111111111111}"
PORT="${PGPORT:-54322}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
URL="postgresql://postgres:${PGPASSWORD}@127.0.0.1:${PORT}/postgres"

baseline() {
  git -C "$ROOT" show 5385d44a:supabase/migrations/20260717000002_baseline_remote_schema.sql \
    | grep -v pg_cron | grep -v MAINTAIN | grep -v maintain
}

if ! psql "$URL" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Start Postgres on port ${PORT} (e.g. public.ecr.aws/supabase/postgres:15.19.0.004)" >&2
  exit 1
fi

baseline | psql "$URL" -v ON_ERROR_STOP=1 -q -f /dev/stdin
for f in "$ROOT"/supabase/migrations/*.sql; do
  ts=$(basename "$f"); ts=${ts%%_*}
  if [ "$ts" -ge 20260905000000 ]; then
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
  fi
done
psql "$URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/migrations/20260802000002_ef_batch_stock_guards.sql"

for t in "$ROOT"/supabase/tests/*.sql; do
  case "$(basename "$t")" in
    *_explain*.sql|_channel_order_fixtures.sql) continue ;;
  esac
  echo "==> $(basename "$t")"
  psql "$URL" -v ON_ERROR_STOP=1 -v owner="$OWNER" -f "$t"
done
