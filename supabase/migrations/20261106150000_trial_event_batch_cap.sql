-- Trial-event lifetime allowance. Changing the cap never resets usage or expiry.
-- Apply to production before deploying the Ops Console cap editor.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.trial_event_grants
  ADD COLUMN IF NOT EXISTS batch_cap integer NOT NULL DEFAULT 100;
ALTER TABLE public.trial_event_grants DROP CONSTRAINT IF EXISTS trial_event_grants_check1;
ALTER TABLE public.trial_event_grants DROP CONSTRAINT IF EXISTS trial_event_grants_batch_cap_check;
ALTER TABLE public.trial_event_grants ADD CONSTRAINT trial_event_grants_batch_cap_check
  CHECK (batch_cap >= 0 AND used_batches >= 0 AND reserved_batches >= 0
    AND used_batches::bigint + reserved_batches::bigint <= batch_cap);
COMMENT ON COLUMN public.trial_event_grants.batch_cap IS
  'Total trial-event batch allowance; defaults to 100. Admin edits do not reset usage, reservations, or expiry.';

CREATE OR REPLACE FUNCTION private.roast_charge_usage(p_user_id uuid)
 RETURNS TABLE(plan text, used_batches integer, reserved_batches integer, batch_cap integer, period_start timestamp with time zone, period_end timestamp with time zone, denial_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g public.trial_event_grants; v_created timestamptz;
BEGIN
  SELECT p.plan, p.created_at INTO plan, v_created FROM public.profiles p WHERE p.id = p_user_id;
  used_batches := 0; reserved_batches := 0;
  IF plan = 'trial-event' THEN
    SELECT * INTO g FROM public.trial_event_grants WHERE user_id = p_user_id;
    batch_cap := coalesce(g.batch_cap, 100);
    period_start := g.started_at; period_end := g.ends_at;
    used_batches := coalesce(g.used_batches, 0); reserved_batches := coalesce(g.reserved_batches, 0);
    IF g.user_id IS NULL OR clock_timestamp() >= period_end THEN denial_code := 'trial_event_expired';
    ELSIF used_batches + reserved_batches >= batch_cap THEN denial_code := 'trial_event_batch_cap'; END IF;
  ELSE
    IF plan = 'trial' THEN
      batch_cap := 20;
      period_start := v_created; period_end := v_created + interval '14 days';
    ELSE
      period_start := date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
      period_end := (period_start AT TIME ZONE 'UTC' + interval '1 month') AT TIME ZONE 'UTC';
      IF plan NOT IN ('pro_plus','tester','enterprise','team') THEN batch_cap := 200; END IF;
    END IF;
    SELECT count(*) FILTER (WHERE b.state IN ('charged','completed'))::integer,
           count(*) FILTER (WHERE b.state = 'reserved')::integer
      INTO used_batches, reserved_batches FROM private.roast_charge_batches b
      WHERE b.user_id = p_user_id
        AND (plan = 'trial' OR (b.usage_at >= period_start AND b.usage_at < period_end));
    IF plan IS NULL OR plan = 'read_only' THEN batch_cap := 0; denial_code := 'read_only_plan';
    ELSIF plan = 'trial' AND clock_timestamp() >= period_end THEN denial_code := 'trial_expired';
    ELSIF used_batches + reserved_batches >= batch_cap THEN
      denial_code := CASE WHEN plan = 'trial' THEN 'trial_batch_cap' ELSE 'monthly_batch_cap_exceeded' END;
    END IF;
  END IF;
  RETURN NEXT;
END;
$function$
  ;

CREATE OR REPLACE FUNCTION public.admin_set_trial_event_batch_cap(p_user_id uuid, p_batch_cap integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_plan text;
  g public.trial_event_grants;
BEGIN
  IF p_user_id IS NULL OR p_batch_cap IS NULL OR p_batch_cap < 0 THEN
    RAISE EXCEPTION 'Invalid total batch cap' USING ERRCODE = '22023';
  END IF;
  -- Same lock order as reservation/completion to serialize with active roasting.
  SELECT plan INTO v_plan FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_plan IS DISTINCT FROM 'trial-event' THEN
    RAISE EXCEPTION 'Trial-event account not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO g FROM public.trial_event_grants WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trial-event grant not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_batch_cap::bigint < g.used_batches::bigint + g.reserved_batches::bigint THEN
    RAISE EXCEPTION 'Total cap cannot be below used and reserved batches' USING ERRCODE = '22023';
  END IF;
  UPDATE public.trial_event_grants SET batch_cap = p_batch_cap
    WHERE user_id = p_user_id RETURNING * INTO g;
  RETURN jsonb_build_object('user_id', g.user_id, 'batch_cap', g.batch_cap,
    'used_batches', g.used_batches, 'reserved_batches', g.reserved_batches, 'ends_at', g.ends_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_trial_event_batch_cap(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_trial_event_batch_cap(uuid, integer) TO service_role;
COMMENT ON FUNCTION public.admin_set_trial_event_batch_cap(uuid, integer) IS
  'Ops Console only: set the total trial-event cap, not an increment. Service role only.';
NOTIFY pgrst, 'reload schema';
COMMIT;
