#!/usr/bin/env bash
# Apply every migration on a throwaway local Postgres, then run supabase/tests SQL.
# Never links a remote project and never talks to hosted Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="${DB_CONTRACT_OWNER:-11111111-1111-4111-8111-111111111111}"
OTHER="${DB_CONTRACT_OTHER:-22222222-2222-4222-8222-222222222222}"
PORT="${DB_CONTRACT_PORT:-55432}"
PROJECT_ID="fc-db-contract"

# Local Supabase default password. Passed via libpq so the script has no connection URL.
psql_local() {
  local user="$1"
  shift
  PGPASSWORD=postgres psql -h 127.0.0.1 -p "$PORT" -U "$user" -d postgres "$@"
}

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI is required (CI pins 2.24.3). See supabase/tests/README.md" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required (postgresql-client)." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
cleanup() {
  supabase stop --workdir "$WORKDIR" --no-backup >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# Drop a previous crashed instance with the same project id.
supabase stop --project-id "$PROJECT_ID" --no-backup >/dev/null 2>&1 || true

mkdir -p "$WORKDIR/supabase/migrations"
cp "$ROOT/supabase/config.toml" "$WORKDIR/supabase/config.toml"
python3 - "$WORKDIR/supabase/config.toml" "$PORT" <<'PY'
import pathlib, sys
path, port = sys.argv[1], sys.argv[2]
text = pathlib.Path(path).read_text()
text = text.replace('project_id = "fc-desktop"', 'project_id = "fc-db-contract"', 1)
text = text.replace("port = 54322", f"port = {port}", 1)
text = text.replace("shadow_port = 54320", "shadow_port = 55420", 1)
# db start runs realtime/storage/auth migrators when those sections are enabled.
# Each one is a separate container that has timed out against a just-booted
# Postgres here. The Postgres image already ships auth.users / auth.uid().
text = text.replace("[realtime]\nenabled = true", "[realtime]\nenabled = false", 1)
text = text.replace("[storage]\nenabled = true", "[storage]\nenabled = false", 1)
text = text.replace("[auth]\nenabled = true", "[auth]\nenabled = false", 1)
pathlib.Path(path).write_text(text)
PY

echo "▶ starting local database"
# Boot Postgres before copying migrations. db start applies whatever is in the
# folder; auth.sessions is created as supabase_admin first (postgres cannot
# write the auth schema), then migration up applies baseline + migrations.
supabase db start --workdir "$WORKDIR"

psql_local supabase_admin -v ON_ERROR_STOP=1 <<'SQL'
-- Gotrue migrate is not run (its container times out). The image's auth.users
-- predates deleted_at, which admin_user_roster reads at CREATE time.
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  ip inet,
  updated_at timestamptz
);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
GRANT USAGE ON SCHEMA auth TO postgres;
GRANT INSERT, SELECT ON auth.users TO postgres;
GRANT ALL ON auth.sessions TO postgres;
SQL

cp "$ROOT/supabase/tests/bootstrap/pre_migration.sql" \
  "$WORKDIR/supabase/migrations/20200101000000_contract_baseline.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$f")"
  # 20260715145935 indexes orders/products, which 20260717000000/01 create.
  # Hosted history applied it after those tables existed. Renaming the repo
  # file would change migration history, so only the throwaway copy moves.
  if [[ "$base" == "20260715145935_order_stock_optimizations.sql" ]]; then
    base="20260717010000_order_stock_optimizations.sql"
  fi
  cp "$f" "$WORKDIR/supabase/migrations/$base"
done

echo "▶ applying baseline + migrations"
supabase migration up --workdir "$WORKDIR" --local

PAYLOAD="$WORKDIR/app_payload.json"
echo "▶ emitting app RPC payloads"
(
  cd "$ROOT"
  DB_CONTRACT_OWNER="$OWNER" DB_CONTRACT_OUT="$PAYLOAD" \
    pnpm exec vitest run src/features/active-roast/model/dbContractPayload.test.ts
)
if [[ ! -s "$PAYLOAD" ]]; then
  echo "contract payload was not written to $PAYLOAD" >&2
  exit 1
fi
APP_PAYLOAD="$(cat "$PAYLOAD")"

echo "▶ seeding contract users"
# supabase_admin owns auth.users. postgres cannot disable its triggers.
psql_local supabase_admin -v ON_ERROR_STOP=1 -v owner="$OWNER" -v other_owner="$OTHER" \
  -f "$ROOT/supabase/tests/bootstrap/seed_users.sql"

shopt -s nullglob
tests=("$ROOT"/supabase/tests/*.sql "$ROOT"/supabase/tests/contract/*.sql)
if [[ ${#tests[@]} -eq 0 ]]; then
  echo "no SQL tests under supabase/tests" >&2
  exit 1
fi

echo "▶ running ${#tests[@]} SQL test(s)"
for f in "${tests[@]}"; do
  echo "  - ${f#"$ROOT"/}"
  psql_local postgres -v ON_ERROR_STOP=1 \
    -v owner="$OWNER" \
    -v other_owner="$OTHER" \
    -v app_payload="$APP_PAYLOAD" \
    -f "$f"
done

echo "✅ db contract tests passed"
