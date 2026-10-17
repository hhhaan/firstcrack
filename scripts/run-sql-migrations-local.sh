#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGPASSWORD
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 --single-transaction)

echo "== bootstrap =="
"${PSQL[@]}" -f "$ROOT/scripts/sql-test-pg-bootstrap.sql"

echo "== migrations =="
shopt -s nullglob
files=("$ROOT"/supabase/migrations/*.sql)
MIN_MIGRATION="${MIN_MIGRATION:-20260717000000}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-20260622000003_inventory_alert_cron.sql,20260715145935_order_stock_optimizations.sql,20260801000002_order_sync_cron.sql}"
PRE_MIGRATIONS=(
  20260516165112_add_business_fields.sql
  20260714000000_profiles_country_code.sql
  20260712000000_roast_session_events.sql
  20260612000000_add_recurrence_rules_blend_id.sql
  20260622000002_inventory_alerts.sql
  20260715000000_cupping.sql
  20260715120000_cupping_events.sql
  20260716150527_cupping_invite_event.sql
  20260716000000_polar_coupons.sql
)
if [[ "$MIN_MIGRATION" > "20260611065045" ]] || [[ "$MIN_MIGRATION" == "20260611065045" ]]; then
  echo "apply 20260611065045_add_blends_and_stock_tables.sql (bootstrap dep)"
  "${PSQL[@]}" -f "$ROOT/supabase/migrations/20260611065045_add_blends_and_stock_tables.sql"
fi
for pre in "${PRE_MIGRATIONS[@]}"; do
  f="$ROOT/supabase/migrations/$pre"
  if [[ -f "$f" ]]; then
    echo "apply $pre (bootstrap dep)"
    "${PSQL[@]}" -f "$f"
  fi
done
for f in $(printf '%s\n' "${files[@]}" | sort); do
  base=$(basename "$f")
  ver="${base%%_*}"
  if [[ ! -s "$f" ]] || [[ "$base" == *_placeholder.sql ]]; then
    echo "skip $base"
    continue
  fi
  if [[ "$base" == "20260611065045_add_blends_and_stock_tables.sql" ]]; then
    continue
  fi
  if [[ ",$SKIP_MIGRATIONS," == *",$base,"* ]]; then
    echo "skip $base (explicit)"
    continue
  fi
  if [[ "$ver" < "$MIN_MIGRATION" ]]; then
    echo "skip $base (before $MIN_MIGRATION)"
    continue
  fi
  echo "apply $base"
  "${PSQL[@]}" -f "$f"
done

echo "== service_role grants =="
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260710133123_restore_service_role_grants.sql"

echo "== migrations done =="
