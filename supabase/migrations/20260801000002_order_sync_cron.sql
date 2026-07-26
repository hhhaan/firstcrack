-- order-sync: real per-connection run lock + the 15-minute schedule the Phase 2 migration only
-- described in a comment. Index + cron job only — no table/function shape change, so
-- src/shared/types/database.types.ts is unaffected.

-- ── 1. Reclaim zombie runs so the unique index below can be created ─────────
-- Invocations killed mid-run leave status='running' forever.

UPDATE order_sync_runs
SET status        = 'error',
    finished_at   = COALESCE(finished_at, now()),
    error_message = COALESCE(error_message, 'stale running run reclaimed by migration')
WHERE status = 'running';

-- ── 2. One in-flight SYNC run per connection ───────────────────────────────
-- Replaces the "was there a running row in the last 10 minutes?" read-then-write heuristic in
-- order-sync with an atomic lock: the INSERT of the 'running' row either wins or raises 23505.
-- order-sync reclaims rows older than 10 minutes on every invocation, so the lock self-heals.
--
-- trigger <> 'webhook' is load-bearing. order-webhook also opens a trigger='webhook' /
-- status='running' row, but for a different purpose: its own idempotency index on
-- (connection_id, external_event_id) makes a 23505 mean "duplicate delivery → ack 200".
-- Without this predicate two concurrent webhooks on one connection would collide on THIS index,
-- and the webhook handler would silently discard a real order as a replay. It would also let a
-- webhook in flight block a manual "Sync now".

CREATE UNIQUE INDEX IF NOT EXISTS order_sync_runs_one_running_per_connection
  ON order_sync_runs (connection_id)
  WHERE status = 'running' AND trigger <> 'webhook';

-- ── 3. Cron: POST order-sync every 15 minutes ──────────────────────────────
-- Inert until an operator stores the shared secret (nothing secret lives in this repo):
--   SELECT vault.create_secret('<ORDER_SYNC_CRON_SECRET>', 'order_sync_cron_secret');
-- The FROM clause returns zero rows while the secret is absent, so no request is made at all.
-- The Edge Function must also have ORDER_SYNC_CRON_SECRET set and be deployed with
-- verify_jwt = false (supabase/config.toml), otherwise the gateway rejects the cron POST.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'order-sync-15min';

    PERFORM cron.schedule(
      'order-sync-15min',
      '*/15 * * * *',
      $job$
        SELECT net.http_post(
          url     := 'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/order-sync',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', s.decrypted_secret
          ),
          body    := '{}'::jsonb
        )
        FROM vault.decrypted_secrets s
        WHERE s.name = 'order_sync_cron_secret'
      $job$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'order-sync cron schedule skipped: %', SQLERRM;
END;
$cron$;
