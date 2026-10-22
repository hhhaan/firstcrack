# DB / RPC contract tests

Local Postgres with `supabase/tests/bootstrap/pre_migration.sql` plus every file in `supabase/migrations/`, then SQL files under `supabase/tests/*.sql` and `supabase/tests/contract/*.sql`. Failure exits non-zero (`ON_ERROR_STOP`).

The baseline is the dashboard-era schema that predates this repo's migrations. The runner copies it into a throwaway project only. It is not a migration and must not be `db push`ed.

Nothing here links a remote project. The runner always uses `127.0.0.1` and the local CLI project. Do not point it at hosted Supabase.

## Run

Requires Docker, the Supabase CLI (CI uses 2.24.3), `psql`, and `pnpm install`.

```bash
pnpm db:contract
```

The script starts Postgres on port 55432 (`DB_CONTRACT_PORT` overrides), applies migrations, seeds two `pro` profiles, and rolls each SQL file back.

## Add a test

**SQL only.** Drop `supabase/tests/<name>.sql`. The runner passes psql variables `owner`, `other_owner`, and `app_payload`. Wrap the body in `BEGIN;` / `ROLLBACK;` so the next file sees the seed users and nothing else. `ASSERT` and `RAISE EXCEPTION` fail the job.

**App payload shape.** `dbContractPayload.test.ts` calls `saveRoastCore` and, when `DB_CONTRACT_OUT` is set, writes JSON. The #619 case is the `save_roast_619` key: fractional `duration_seconds` (auto-drop elapsed) that `save_roast_op` must round into the integer column. Add another key in that test and read it from a new file in `supabase/tests/contract/`. `app_payload` is forwarded to every SQL file.
