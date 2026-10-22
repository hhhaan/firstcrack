-- PR-G (#899, #907): per-connection cron dispatch + scheduler observability.
-- K=10 dispatches / 2 min, M=15 min poll floor, 10 min stale lock skip, 30 min overdue metric.

-- ── 1. products listing joins the per-connection run lock ───────────────────
ALTER TABLE public.order_sync_runs
  DROP CONSTRAINT IF EXISTS order_sync_runs_trigger_check;

ALTER TABLE public.order_sync_runs
  ADD CONSTRAINT order_sync_runs_trigger_check
  CHECK (trigger IN ('cron', 'manual', 'webhook', 'dispatch', 'products'));

-- ── 2. Scheduler tick log (cron-role only; not workspace-readable) ──────────
CREATE TABLE public.order_sync_scheduler_ticks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  status                  text NOT NULL CHECK (status IN ('no_due_connections', 'dispatched')),
  due_count               integer NOT NULL DEFAULT 0,
  overdue_count           integer NOT NULL DEFAULT 0,
  dispatched_count        integer NOT NULL DEFAULT 0,
  skipped_locked_count    integer NOT NULL DEFAULT 0,
  oldest_last_polled_at   timestamptz,
  dispatches              jsonb NOT NULL DEFAULT '[]'::jsonb
);

COMMENT ON COLUMN public.order_sync_scheduler_ticks.oldest_last_polled_at IS
  'Among due connections this tick: NULL when any due row has never been polled (last_polled_at IS NULL); otherwise MIN(last_polled_at).';

ALTER TABLE public.order_sync_scheduler_ticks ENABLE ROW LEVEL SECURITY;
-- skip-grant-check: cron-role scheduler log; workspace members do not read it

REVOKE ALL ON TABLE public.order_sync_scheduler_ticks FROM PUBLIC, anon, authenticated;

CREATE INDEX order_sync_scheduler_ticks_created_at_idx
  ON public.order_sync_scheduler_ticks (created_at);

-- ── 3. Per-connection dispatch (pg_cron every 2 minutes) ─────────────────────
CREATE OR REPLACE FUNCTION public.invoke_order_sync_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_secret            text;
  v_dispatch_cap      constant integer := 10;
  v_min_interval      constant interval := interval '15 minutes';
  v_stale_lock        constant interval := interval '10 minutes';
  v_overdue_threshold constant interval := interval '30 minutes';
  v_due_count         integer;
  v_overdue_count     integer;
  v_skipped_locked    integer;
  v_dispatched        integer := 0;
  v_oldest_polled     timestamptz;
  v_dispatches        jsonb := '[]'::jsonb;
  v_conn_id           uuid;
  v_request_id        bigint;
  v_url               constant text :=
    'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/order-sync';
BEGIN
  SELECT s.decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets s
  WHERE s.name = 'order_sync_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE EXCEPTION 'order_sync_cron_secret is not configured' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_overdue_count
  FROM public.sales_channel_connections c
  WHERE c.status = 'active'
    AND (c.last_polled_at IS NULL OR c.last_polled_at < now() - v_overdue_threshold);

  WITH due AS (
    SELECT c.id, c.last_polled_at
    FROM public.sales_channel_connections c
    WHERE c.status = 'active'
      AND (c.last_polled_at IS NULL OR c.last_polled_at < now() - v_min_interval)
  )
  SELECT
    (SELECT count(*)::integer FROM due),
    (SELECT count(*)::integer FROM due d
     WHERE EXISTS (
       SELECT 1 FROM public.order_sync_runs r
       WHERE r.connection_id = d.id
         AND r.status = 'running'
         AND r.trigger <> 'webhook'
         AND r.started_at >= now() - v_stale_lock
     )),
    (SELECT CASE
       WHEN EXISTS (SELECT 1 FROM due d WHERE d.last_polled_at IS NULL) THEN NULL
       ELSE (SELECT min(d.last_polled_at) FROM due d)
     END)
  INTO v_due_count, v_skipped_locked, v_oldest_polled;

  IF v_due_count = 0 THEN
    INSERT INTO public.order_sync_scheduler_ticks (
      status, due_count, overdue_count, dispatched_count, skipped_locked_count, oldest_last_polled_at
    ) VALUES (
      'no_due_connections', 0, v_overdue_count, 0, 0, NULL
    );
    DELETE FROM public.order_sync_scheduler_ticks
    WHERE created_at < now() - interval '90 days';
    RETURN;
  END IF;

  FOR v_conn_id IN
    WITH due AS (
      SELECT c.id, c.last_polled_at
      FROM public.sales_channel_connections c
      WHERE c.status = 'active'
        AND (c.last_polled_at IS NULL OR c.last_polled_at < now() - v_min_interval)
    )
    SELECT d.id
    FROM due d
    WHERE NOT EXISTS (
      SELECT 1 FROM public.order_sync_runs r
      WHERE r.connection_id = d.id
        AND r.status = 'running'
        AND r.trigger <> 'webhook'
        AND r.started_at >= now() - v_stale_lock
    )
    ORDER BY d.last_polled_at ASC NULLS FIRST, d.id
    LIMIT v_dispatch_cap
  LOOP
    SELECT net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret
      ),
      body    := jsonb_build_object('connectionId', v_conn_id::text)
    ) INTO v_request_id;

    v_dispatches := v_dispatches || jsonb_build_array(
      jsonb_build_object('connection_id', v_conn_id::text, 'net_request_id', v_request_id)
    );
    v_dispatched := v_dispatched + 1;
  END LOOP;

  INSERT INTO public.order_sync_scheduler_ticks (
    status,
    due_count,
    overdue_count,
    dispatched_count,
    skipped_locked_count,
    oldest_last_polled_at,
    dispatches
  ) VALUES (
    'dispatched',
    v_due_count,
    v_overdue_count,
    v_dispatched,
    v_skipped_locked,
    v_oldest_polled,
    v_dispatches
  );

  DELETE FROM public.order_sync_scheduler_ticks
  WHERE created_at < now() - interval '90 days';
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_order_sync_cron() FROM PUBLIC;

-- ── 4. pg_cron: every 2 minutes (inert locally when pg_cron is absent) ─────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN ('order-sync-15min', 'order-sync-2min');

    PERFORM cron.schedule(
      'order-sync-2min',
      '*/2 * * * *',
      'SELECT public.invoke_order_sync_cron()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'order-sync cron schedule skipped: %', SQLERRM;
END;
$cron$;
