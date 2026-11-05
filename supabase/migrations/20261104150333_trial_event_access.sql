-- Outreach trial: Enterprise features, 90 days from the first explicit grant,
-- and 100 Charges. Discarding after Charge never refunds use.
-- Existing trial/tester accounts are unchanged.
-- Set profiles.plan = 'trial-event' as an administrator to enroll an account.

ALTER TABLE public.profiles DROP CONSTRAINT profiles_plan_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('trial', 'trial-event', 'read_only', 'free', 'pro', 'pro_plus', 'tester', 'team', 'enterprise'));

CREATE TABLE public.trial_event_grants (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  used_batches integer NOT NULL DEFAULT 0,
  reserved_batches integer NOT NULL DEFAULT 0,
  CHECK (ends_at = started_at + interval '2160 hours'),
  CHECK (used_batches >= 0 AND reserved_batches >= 0 AND used_batches + reserved_batches <= 100)
);
ALTER TABLE public.trial_event_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_event_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.trial_event_grants TO authenticated;
GRANT ALL ON public.trial_event_grants TO service_role;
CREATE POLICY trial_event_workspace_read ON public.trial_event_grants
  FOR SELECT TO authenticated USING (public.has_workspace_access(user_id));

CREATE SCHEMA IF NOT EXISTS private;
-- No session FK: deleting a saved roast must not refund a completed batch.
CREATE TABLE private.roast_charge_batches (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('reserved', 'charged', 'completed', 'released')),
  usage_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_grant boolean NOT NULL DEFAULT false,
  completed_xid bigint
);
CREATE INDEX roast_charge_batches_owner_idx ON private.roast_charge_batches(user_id, usage_at);
ALTER TABLE private.roast_charge_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.roast_charge_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.roast_charge_batches TO service_role;

CREATE FUNCTION private.grant_trial_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_start timestamptz := clock_timestamp();
BEGIN
  IF NEW.plan = 'trial-event' THEN
    -- The existing billing-column guard freezes client plan writes BEFORE this
    -- AFTER trigger. Re-enrollment and profile edits never restart the trial.
    INSERT INTO public.trial_event_grants(user_id, started_at, ends_at)
      VALUES (NEW.id, v_start, v_start + interval '2160 hours')
      ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


REVOKE ALL ON FUNCTION private.grant_trial_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_trial_event_grant AFTER INSERT OR UPDATE OF plan ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.grant_trial_event();

-- Preserve pre-rollout consumption even if history is later deleted. We cannot
-- reconstruct discarded historical Charges; completed history is the baseline.
INSERT INTO private.roast_charge_batches(session_id, user_id, state, usage_at)
  SELECT id, user_id, 'completed', coalesce(roasted_at, '-infinity'::timestamptz)
  FROM public.roast_sessions WHERE status = 'completed';

-- Internal read: callers must authorize before exposing it. Reservation/Charge
-- mutations lock the profile first, so every plan shares one owner-level lock.
CREATE FUNCTION private.roast_charge_usage(p_user_id uuid)
RETURNS TABLE(plan text, used_batches integer, reserved_batches integer,
  batch_cap integer, period_start timestamptz, period_end timestamptz, denial_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.trial_event_grants; v_created timestamptz;
BEGIN
  SELECT p.plan, p.created_at INTO plan, v_created FROM public.profiles p WHERE p.id = p_user_id;
  used_batches := 0; reserved_batches := 0;
  IF plan = 'trial-event' THEN
    SELECT * INTO g FROM public.trial_event_grants WHERE user_id = p_user_id;
    batch_cap := 100;
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
$$;
REVOKE ALL ON FUNCTION private.roast_charge_usage(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.get_roast_charge_usage(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT to_jsonb(u) FROM private.roast_charge_usage(p_user_id) u);
END;
$$;

CREATE FUNCTION private.reserve_roast_charge(p_user_id uuid, p_session_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u record; b private.roast_charge_batches;
BEGIN
  IF auth.uid() IS NULL OR p_session_id IS NULL OR NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  SELECT * INTO b FROM private.roast_charge_batches WHERE session_id = p_session_id;
  IF FOUND THEN
    IF b.user_id <> p_user_id OR b.state <> 'reserved' THEN
      RAISE EXCEPTION 'invalid roast Charge reservation' USING ERRCODE = '23514';
    END IF;
    RETURN p_session_id;
  END IF;
  SELECT * INTO u FROM private.roast_charge_usage(p_user_id);
  IF u.denial_code IS NOT NULL THEN RAISE EXCEPTION '%', u.denial_code USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.roast_sessions WHERE id = p_session_id) THEN
    RAISE EXCEPTION 'session already exists' USING ERRCODE = '23514';
  END IF;
  INSERT INTO private.roast_charge_batches(session_id,user_id,state,event_grant)
    VALUES (p_session_id,p_user_id,'reserved',u.plan = 'trial-event');
  IF u.plan = 'trial-event' THEN
    UPDATE public.trial_event_grants SET reserved_batches = reserved_batches + 1 WHERE user_id = p_user_id;
  END IF;
  RETURN p_session_id;
END;
$$;

CREATE FUNCTION private.record_roast_charge(p_user_id uuid, p_session_id uuid, p_charged_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b private.roast_charge_batches; v_plan text;
BEGIN
  IF auth.uid() IS NULL OR p_session_id IS NULL OR NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
  END IF;
  SELECT plan INTO v_plan FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  SELECT * INTO b FROM private.roast_charge_batches WHERE session_id = p_session_id;
  IF NOT FOUND THEN
    -- Unlimited accounts keep recording offline. Their durable Charge outbox
    -- carries the occurrence time; capped accounts must already hold admission.
    IF v_plan NOT IN ('pro_plus','tester','enterprise','team') OR v_plan IS NULL THEN
      RAISE EXCEPTION 'roast Charge reservation required' USING ERRCODE = '23514';
    END IF;
    IF p_charged_at IS NULL OR NOT isfinite(p_charged_at) OR p_charged_at > clock_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'invalid Charge time' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.roast_sessions WHERE id = p_session_id AND user_id <> p_user_id) THEN
      RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
    END IF;
    INSERT INTO private.roast_charge_batches(session_id,user_id,state,usage_at)
      VALUES (p_session_id,p_user_id,'charged',p_charged_at);
    RETURN;
  END IF;
  IF b.user_id <> p_user_id OR b.state = 'released' THEN
    RAISE EXCEPTION 'invalid roast Charge reservation' USING ERRCODE = '23514';
  END IF;
  IF b.state IN ('charged','completed') THEN RETURN; END IF;
  -- A prepared Charge belongs to its admitted period even if acknowledgement
  -- arrives after midnight/expiry. The desktop retires unused slots at rollover.
  UPDATE private.roast_charge_batches SET state = 'charged' WHERE session_id = p_session_id;
  IF b.event_grant THEN
    UPDATE public.trial_event_grants SET reserved_batches = reserved_batches - 1, used_batches = used_batches + 1
      WHERE user_id = p_user_id;
  END IF;
END;
$$;

CREATE FUNCTION private.release_roast_charge(p_user_id uuid, p_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b private.roast_charge_batches;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  UPDATE private.roast_charge_batches SET state = 'released'
    WHERE session_id = p_session_id AND user_id = p_user_id AND state = 'reserved' RETURNING * INTO b;
  IF FOUND AND b.event_grant THEN
    UPDATE public.trial_event_grants SET reserved_batches = reserved_batches - 1 WHERE user_id = p_user_id;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON FUNCTION private.get_roast_charge_usage(uuid), private.reserve_roast_charge(uuid,uuid),
  private.record_roast_charge(uuid,uuid,timestamptz), private.release_roast_charge(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_roast_charge_usage(uuid), private.reserve_roast_charge(uuid,uuid),
  private.record_roast_charge(uuid,uuid,timestamptz), private.release_roast_charge(uuid,uuid) TO authenticated;
CREATE FUNCTION public.get_roast_charge_usage(p_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.get_roast_charge_usage(p_user_id); $$;
CREATE FUNCTION public.reserve_roast_charge(p_user_id uuid, p_session_id uuid) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.reserve_roast_charge(p_user_id,p_session_id); $$;
CREATE FUNCTION public.record_roast_charge(p_user_id uuid, p_session_id uuid, p_charged_at timestamptz) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.record_roast_charge(p_user_id,p_session_id,p_charged_at); $$;
CREATE FUNCTION public.release_roast_charge(p_user_id uuid, p_session_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.release_roast_charge(p_user_id,p_session_id); $$;
REVOKE ALL ON FUNCTION public.get_roast_charge_usage(uuid), public.reserve_roast_charge(uuid,uuid),
  public.record_roast_charge(uuid,uuid,timestamptz), public.release_roast_charge(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_roast_charge_usage(uuid), public.reserve_roast_charge(uuid,uuid),
  public.record_roast_charge(uuid,uuid,timestamptz), public.release_roast_charge(uuid,uuid) TO authenticated;

CREATE FUNCTION private.complete_roast_charge() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u record; b private.roast_charge_batches;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.profiles WHERE id = NEW.user_id FOR UPDATE;
  SELECT * INTO b FROM private.roast_charge_batches WHERE session_id = NEW.id;
  IF FOUND THEN
    IF b.user_id <> NEW.user_id OR b.state = 'released' THEN
      RAISE EXCEPTION 'invalid roast Charge reservation' USING ERRCODE = '23514';
    END IF;
    IF b.state = 'completed' THEN
      IF NOT EXISTS (SELECT 1 FROM public.roast_sessions WHERE id = NEW.id AND user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'completed roast Charge was deleted' USING ERRCODE = '23514';
      END IF;
    ELSIF b.state = 'reserved' AND b.event_grant THEN
      UPDATE public.trial_event_grants SET reserved_batches = reserved_batches - 1, used_batches = used_batches + 1
        WHERE user_id = NEW.user_id;
    END IF;
    -- Saving is not another Charge. This also settles a missing acknowledgement.
    UPDATE private.roast_charge_batches SET state = 'completed', completed_xid = txid_current() WHERE session_id = NEW.id;
  ELSE
    -- Legacy/import clients have no admission. Their first completed save is the
    -- compatibility Charge; only active accounts with remaining capacity qualify.
    SELECT * INTO u FROM private.roast_charge_usage(NEW.user_id);
    IF u.denial_code IS NOT NULL THEN RAISE EXCEPTION '%', u.denial_code USING ERRCODE = '23514'; END IF;
    INSERT INTO private.roast_charge_batches(session_id,user_id,state,event_grant,completed_xid)
      VALUES (NEW.id,NEW.user_id,'completed',u.plan = 'trial-event',txid_current());
    IF u.plan = 'trial-event' THEN
      UPDATE public.trial_event_grants SET used_batches = used_batches + 1 WHERE user_id = NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.complete_roast_charge() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_00_roast_charge BEFORE INSERT OR UPDATE ON public.roast_sessions
  FOR EACH ROW EXECUTE FUNCTION private.complete_roast_charge();

CREATE OR REPLACE FUNCTION public.profile_write_error(p_user_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u record; v_plan text;
BEGIN
  SELECT plan INTO v_plan FROM public.profiles WHERE id = p_user_id;
  IF v_plan = 'read_only' THEN RETURN 'read_only_plan'; END IF;
  IF EXISTS (SELECT 1 FROM private.roast_charge_batches WHERE user_id = p_user_id
    AND state = 'completed' AND completed_xid = txid_current()) THEN RETURN NULL; END IF;
  IF v_plan IN ('trial','trial-event') THEN
    SELECT * INTO u FROM private.roast_charge_usage(p_user_id);
    -- Preparations alone must not make the rest of the workspace read-only.
    IF u.denial_code IN ('trial_expired','trial_event_expired') THEN RETURN u.denial_code; END IF;
    IF u.used_batches >= u.batch_cap THEN RETURN u.denial_code; END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_batch_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE gate_err text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;
  -- trg_00_roast_charge has already enforced admission/capacity. Counting saved
  -- rows here would reject the already-paid-for final Charge or charge twice.
  gate_err := public.profile_write_error(NEW.user_id);
  IF gate_err IS NOT NULL THEN RAISE EXCEPTION '%', gate_err USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_profile_writable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid; gate_err text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN NEW; END IF;
  v_user := COALESCE(NEW.user_id, OLD.user_id);
  -- Curve upload happens after the atomic save, sometimes after expiry. Permit
  -- only its path metadata; this does not reopen history/inventory edits.
  IF TG_TABLE_NAME = 'roast_sessions' AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['tsv_path','bbp_tsv_path','updated_at']) IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['tsv_path','bbp_tsv_path','updated_at'])
     AND EXISTS (SELECT 1 FROM private.roast_charge_batches WHERE user_id = v_user AND session_id = NEW.id AND state = 'completed')
  THEN RETURN NEW; END IF;
  gate_err := public.profile_write_error(v_user);
  -- shortcut: schedule writes get 24h admission grace; use a save-scoped RPC if stricter billing is needed.
  IF TG_TABLE_NAME = 'roast_day_plans'
     AND gate_err IN ('trial_expired','trial_event_expired','trial_batch_cap','trial_event_batch_cap')
     AND EXISTS (SELECT 1 FROM private.roast_charge_batches WHERE user_id = v_user
       AND state IN ('reserved','charged') AND usage_at > clock_timestamp() - interval '24 hours')
  THEN RETURN NEW; END IF;
  IF gate_err IS NOT NULL THEN
    RAISE EXCEPTION '%', gate_err USING ERRCODE = '23514', DETAIL = format('table=%s user=%s', TG_TABLE_NAME, v_user);
  END IF;
  RETURN NEW;
END;
$$;

-- Event trials can host the same five-seat workspace as tester.
-- Bound caller-provided organization invites; existing invites are unchanged.
CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_token text,
  p_expires_in interval DEFAULT '7 days'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_seat_limit integer;
  v_member_count integer;
  v_pending_count integer;
  v_name text;
  v_plan text;
  v_invite_id uuid;
  v_default_seats integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  -- Match the desktop's URL-safe 128-bit token format and bound custom clients.
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{22,128}$' THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  IF p_expires_in IS NULL OR p_expires_in <= interval '0 seconds' OR p_expires_in > interval '7 days' THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  SELECT plan INTO v_plan FROM profiles WHERE id = v_uid;
  -- Team invites: enterprise-class (+ internal tester mirror; legacy: team).
  IF v_plan IS NULL OR v_plan NOT IN ('enterprise', 'team', 'tester', 'trial-event') THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF v_plan = 'trial-event' AND public.profile_write_error(v_uid) IS NOT NULL THEN
    RAISE EXCEPTION 'trial_event_expired' USING ERRCODE = '23514';
  END IF;

  SELECT id, seat_limit INTO v_org_id, v_seat_limit
  FROM organizations
  WHERE owner_id = v_uid
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    SELECT COALESCE(nullif(trim(business_name), ''), 'My Roastery')
    INTO v_name
    FROM profiles
    WHERE id = v_uid;

    v_default_seats := 5;

    INSERT INTO organizations (owner_id, name, seat_limit)
    VALUES (v_uid, COALESCE(v_name, 'My Roastery'), v_default_seats)
    RETURNING id, seat_limit INTO v_org_id, v_seat_limit;

    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

    SELECT id, seat_limit INTO v_org_id, v_seat_limit
    FROM organizations
    WHERE id = v_org_id
    FOR UPDATE;
  END IF;

  SELECT count(*)::integer INTO v_member_count
  FROM organization_members
  WHERE org_id = v_org_id;

  SELECT count(*)::integer INTO v_pending_count
  FROM organization_invites
  WHERE org_id = v_org_id
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF v_member_count + v_pending_count + 1 > v_seat_limit THEN
    RAISE EXCEPTION 'seat_limit_reached';
  END IF;

  INSERT INTO organization_invites (org_id, token, expires_at)
  VALUES (v_org_id, p_token, now() + p_expires_in)
  RETURNING id INTO v_invite_id;

  RETURN v_invite_id;
END;
$$;


-- Read-only integration access follows the existing tester feature scope.
CREATE OR REPLACE FUNCTION private.mcp_read(token_hash text, expected_issuer text, expected_resource text, tool text, args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE proof jsonb; v_owner_id uuid; subject_id uuid; lim integer; off integer; result jsonb; v_plan text;
BEGIN
    proof := private.mcp_access(token_hash, expected_issuer, expected_resource);
    IF proof IS NULL THEN RETURN jsonb_build_object('error', 'invalid_token'); END IF;
    IF jsonb_typeof(args) IS DISTINCT FROM 'object' OR (args - 'limit' - 'offset' - 'workspace_owner_id') <> '{}'::jsonb
       OR coalesce(args ->> 'limit', '50') !~ '^[0-9]+$' OR coalesce(args ->> 'offset', '0') !~ '^[0-9]+$' THEN
        RETURN jsonb_build_object('error', 'invalid_request');
    END IF;
    lim := coalesce(args ->> 'limit', '50')::integer; off := coalesce(args ->> 'offset', '0')::integer;
    IF lim NOT BETWEEN 1 AND 100 OR off NOT BETWEEN 0 AND 10000 THEN RETURN jsonb_build_object('error', 'invalid_request'); END IF;
    v_owner_id := (proof ->> 'firstcrack_workspace_owner_id')::uuid; subject_id := (proof ->> 'sub')::uuid;
    IF args ? 'workspace_owner_id' AND args ->> 'workspace_owner_id' IS DISTINCT FROM v_owner_id::text THEN RETURN jsonb_build_object('error', 'access_denied'); END IF;
    -- Even a caller with this function's execution credential cannot choose its own user context.
    PERFORM set_config('request.jwt.claims', proof::text, true);
    PERFORM set_config('request.jwt.claim.sub', subject_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'firstcrack_mcp_data', true);
    PERFORM set_config('transaction_read_only', 'on', true);
    SELECT plan INTO v_plan FROM public.profiles WHERE id = v_owner_id;
    IF v_plan IS NULL OR v_plan NOT IN ('pro', 'pro_plus', 'enterprise', 'team', 'tester', 'trial-event') THEN
        RETURN jsonb_build_object('error', 'insufficient_plan');
    END IF;
    CASE tool
    WHEN 'get_my_profile' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (SELECT id, display_name, business_name, country_code FROM public.profiles WHERE id = subject_id ORDER BY id LIMIT lim + 1 OFFSET off) q;
    WHEN 'list_my_workspaces' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (SELECT o.id, o.owner_id, o.name FROM public.organizations o WHERE o.owner_id = v_owner_id ORDER BY o.id LIMIT lim + 1 OFFSET off) q;
    WHEN 'list_green_stock' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (
            SELECT b.id, b.name, b.origin, b.low_stock_threshold_grams,
                coalesce((SELECT sum(e.delta_grams)::integer FROM public.bean_stock_events e
                    WHERE e.bean_id = b.id AND e.user_id = v_owner_id AND e.event_type IS DISTINCT FROM 'expected_inbound'), 0) AS on_hand_grams
            FROM public.beans b WHERE b.user_id = v_owner_id ORDER BY b.id LIMIT lim + 1 OFFSET off
        ) q;
    WHEN 'list_roasted_stock' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (
            SELECT e.bean_id, e.blend_id, coalesce(sum(e.delta_grams), 0)::integer AS on_hand_grams
            FROM public.roasted_stock_events e WHERE e.user_id = v_owner_id
            GROUP BY e.bean_id, e.blend_id ORDER BY e.bean_id, e.blend_id LIMIT lim + 1 OFFSET off
        ) q;
    WHEN 'list_product_stock' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (
            SELECT p.id, p.name, p.sku, p.is_active,
                coalesce((SELECT sum(e.delta_units)::integer FROM public.product_stock_events e
                    WHERE e.product_id = p.id AND e.user_id = v_owner_id), 0) AS on_hand_units
            FROM public.products p WHERE p.user_id = v_owner_id ORDER BY p.id LIMIT lim + 1 OFFSET off
        ) q;
    WHEN 'list_orders' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (
            SELECT o.id, o.platform, o.platform_order_id, o.status, o.ordered_at, o.fulfilled_at,
                (SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) FROM (SELECT id, product_id, title, quantity, status FROM public.order_lines WHERE order_id = o.id AND user_id = v_owner_id ORDER BY id LIMIT 1000) l) AS order_lines
            FROM public.orders o WHERE o.user_id = v_owner_id ORDER BY o.id LIMIT lim + 1 OFFSET off
        ) q;
    ELSE RETURN jsonb_build_object('error', 'invalid_request');
    END CASE;
    RETURN jsonb_build_object('rows', result);
END $$;

CREATE OR REPLACE FUNCTION public.enforce_profile_writable_plan_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  gate_err text;
BEGIN
  -- #124: gate USER writes only; service_role / postgres automation is exempt.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_user FROM public.roast_day_plans
  WHERE id = COALESCE(NEW.plan_id, OLD.plan_id);

  -- Finishing the derived progress of a committed roast is allowed after
  -- expiry. Only status may change, and the saved sessions must prove completion.
  IF TG_OP = 'UPDATE' AND NEW.status = 'done' AND OLD.status <> 'cancelled'
     AND NEW.exception_type IS DISTINCT FROM 'cancelled'
     AND (to_jsonb(NEW) - ARRAY['status','updated_at']) IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status','updated_at'])
     AND EXISTS (SELECT 1 FROM private.roast_charge_batches e JOIN public.roast_sessions r ON r.id = e.session_id
       WHERE e.user_id = v_user AND e.state = 'completed' AND r.plan_batch_id = NEW.id)
     AND (SELECT count(*) FROM public.roast_sessions WHERE plan_batch_id = NEW.id AND status = 'completed') >= NEW.batch_count
  THEN RETURN NEW; END IF;

  gate_err := public.profile_write_error(v_user);
  -- Match day-plan grace so summary/recovery can materialize the occurrence before saving.
  IF gate_err IN ('trial_expired','trial_event_expired','trial_batch_cap','trial_event_batch_cap')
     AND EXISTS (SELECT 1 FROM private.roast_charge_batches WHERE user_id = v_user
       AND state IN ('reserved','charged') AND usage_at > clock_timestamp() - interval '24 hours')
  THEN RETURN NEW; END IF;
  IF gate_err IS NOT NULL THEN
    RAISE EXCEPTION '%', gate_err
      USING ERRCODE = 'check_violation',
            DETAIL = format('table=%s user=%s', TG_TABLE_NAME, v_user);
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve the deployed MCP dispatcher's owner, ACL and implementation while
-- extending its existing plan check. An expired event grant cannot write via MCP.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('private.mcp_write(text,text,text,text,jsonb)'::regprocedure);
  old_gate text := $gate$IF current_plan IS NULL OR current_plan NOT IN ('pro_plus', 'enterprise', 'team', 'tester') THEN$gate$;
  new_gate text := $gate$IF current_plan IS NULL OR current_plan NOT IN ('pro_plus', 'enterprise', 'team', 'tester', 'trial-event')
    OR (current_plan = 'trial-event' AND public.profile_write_error(owner_id) IS NOT NULL) THEN$gate$;
BEGIN
  IF strpos(definition, old_gate) = 0 THEN
    RAISE EXCEPTION 'MCP plan gate changed; review trial-event integration before applying';
  END IF;
  EXECUTE replace(definition, old_gate, new_gate);
END;
$migration$;
