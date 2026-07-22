-- Phase 4: inventory alert cron + run logging

CREATE TABLE inventory_alert_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  users_processed integer NOT NULL DEFAULT 0,
  error_message text
);

ALTER TABLE inventory_alert_runs ENABLE ROW LEVEL SECURITY;

-- Runs are system-level; no user policy (service role / cron only writes)

CREATE OR REPLACE FUNCTION compute_inventory_alerts_for_all_users(
  p_horizon_days integer DEFAULT 28
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_user_id uuid;
  v_count integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(867530901) THEN
    RAISE NOTICE 'inventory alert compute already running';
    RETURN NULL;
  END IF;

  INSERT INTO inventory_alert_runs (status)
  VALUES ('running')
  RETURNING id INTO v_run_id;

  BEGIN
    FOR v_user_id IN
      SELECT DISTINCT user_id FROM beans
    LOOP
      PERFORM compute_inventory_alerts(v_user_id, p_horizon_days);
      v_count := v_count + 1;
    END LOOP;

    UPDATE inventory_alert_runs
    SET status = 'success',
        finished_at = now(),
        users_processed = v_count
    WHERE id = v_run_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE inventory_alert_runs
    SET status = 'error',
        finished_at = now(),
        users_processed = v_count,
        error_message = SQLERRM
    WHERE id = v_run_id;
    RAISE;
  END;

  RETURN v_run_id;
END;
$$;

-- Schedule daily run (requires pg_cron extension on Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'daily-inventory-alerts';

    PERFORM cron.schedule(
      'daily-inventory-alerts',
      '0 6 * * *',
      'SELECT compute_inventory_alerts_for_all_users(28)'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$cron$;
