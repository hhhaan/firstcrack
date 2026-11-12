-- Finding 1: cron inventory alerts without auth.uid()
-- Finding 2: close plan-oracle EXECUTE on definer gate helpers
-- Finding 3: signup Slack webhook secret via Vault (mirror notify_roast_slack)

CREATE OR REPLACE FUNCTION private.profile_write_error(p_user_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u record; v_plan text;
BEGIN
  SELECT plan INTO v_plan FROM public.profiles WHERE id = p_user_id;
  IF v_plan = 'read_only' THEN RETURN 'read_only_plan'; END IF;
  IF EXISTS (SELECT 1 FROM private.roast_charge_batches WHERE user_id = p_user_id
    AND state = 'completed' AND completed_xid = txid_current()) THEN RETURN NULL; END IF;
  IF v_plan IN ('trial','trial-event') THEN
    SELECT * INTO u FROM private.roast_charge_usage(p_user_id);
    IF u.denial_code IN ('trial_expired','trial_event_expired') THEN RETURN u.denial_code; END IF;
    IF u.used_batches >= u.batch_cap THEN RETURN u.denial_code; END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.profile_write_error(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.profile_write_error(p_user_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION 'not_callable' USING ERRCODE = '42501';
  END IF;
  RETURN private.profile_write_error(p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.profile_write_error(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_write_error(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.enforce_batch_gate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_batch_gate() TO authenticated;

REVOKE ALL ON FUNCTION public.enforce_profile_writable() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_profile_writable() TO authenticated;

REVOKE ALL ON FUNCTION public.enforce_profile_writable_plan_batch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_profile_writable_plan_batch() TO authenticated;

CREATE OR REPLACE FUNCTION public.compute_inventory_alerts_for_all_users(
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
      PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
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

REVOKE ALL ON FUNCTION public.compute_inventory_alerts_for_all_users(integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.notify_signup_slack()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_url text := 'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/notify-signup';
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'notify_signup_secret';
    IF NULLIF(v_secret, '') IS NULL THEN
      RAISE WARNING 'notify_signup_slack skipped: Vault configuration missing';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'record', jsonb_build_object(
          'id', NEW.id,
          'email', NEW.email,
          'created_at', NEW.created_at,
          'raw_user_meta_data', NEW.raw_user_meta_data
        )
      ),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
    RAISE WARNING 'notify_signup_slack enqueue failed (%)', SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_signup_slack() FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
  definition text;
BEGIN
  definition := pg_get_functiondef('public.create_org_invite(text,interval)'::regprocedure);
  IF strpos(definition, 'public.profile_write_error(v_uid)') = 0 THEN
    RAISE EXCEPTION 'create_org_invite plan gate moved; review trial-event integration';
  END IF;
  EXECUTE replace(definition, 'public.profile_write_error(v_uid)', 'private.profile_write_error(v_uid)');
END;
$migration$;

DO $migration$
DECLARE
  definition text;
  old_gate text := $gate$OR (current_plan = 'trial-event' AND public.profile_write_error(owner_id) IS NOT NULL) THEN$gate$;
  new_gate text := $gate$OR (current_plan = 'trial-event' AND private.profile_write_error(owner_id) IS NOT NULL) THEN$gate$;
BEGIN
  definition := pg_get_functiondef('private.mcp_write(text,text,text,text,jsonb)'::regprocedure);
  IF strpos(definition, old_gate) = 0 THEN
    RAISE EXCEPTION 'MCP trial-event gate changed; review before applying';
  END IF;
  EXECUTE replace(definition, old_gate, new_gate);
END;
$migration$;
