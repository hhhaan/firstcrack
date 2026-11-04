-- Outreach trial: Enterprise features, 90 days from the first explicit grant,
-- and 100 completed roast sessions. Existing trial/tester accounts are unchanged.
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
CREATE TABLE private.trial_event_batches (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.trial_event_grants(user_id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('reserved', 'completed', 'released')),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_xid bigint
);
CREATE INDEX trial_event_batches_owner_idx ON private.trial_event_batches(user_id);
ALTER TABLE private.trial_event_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.trial_event_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.trial_event_batches TO service_role;

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

-- A short row lock serializes reservations, completion and cancellation across
-- devices/workspace members. The session UUID is also the save retry identity.
CREATE FUNCTION private.reserve_trial_event_batch(p_user_id uuid, p_session_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.trial_event_grants; b private.trial_event_batches; v_plan text;
BEGIN
  IF auth.uid() IS NULL OR p_session_id IS NULL OR NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
  END IF;
  SELECT plan INTO v_plan FROM public.profiles WHERE id = p_user_id;
  -- A checkout may have finished between the client's plan read and this call.
  IF v_plan IN ('pro', 'pro_plus', 'enterprise', 'team', 'tester') THEN RETURN p_session_id; END IF;
  IF v_plan IS DISTINCT FROM 'trial-event' THEN
    RAISE EXCEPTION 'read_only_plan' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO g FROM public.trial_event_grants WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trial_event_expired' USING ERRCODE = '23514'; END IF;
  SELECT * INTO b FROM private.trial_event_batches WHERE session_id = p_session_id;
  IF FOUND THEN
    IF b.user_id <> p_user_id OR b.state <> 'reserved' THEN
      RAISE EXCEPTION 'invalid trial event reservation' USING ERRCODE = '23514';
    END IF;
    RETURN p_session_id;
  END IF;
  IF clock_timestamp() >= g.ends_at THEN RAISE EXCEPTION 'trial_event_expired' USING ERRCODE = '23514'; END IF;
  IF g.used_batches + g.reserved_batches >= 100 THEN
    RAISE EXCEPTION 'trial_event_batch_cap' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.roast_sessions WHERE id = p_session_id) THEN
    RAISE EXCEPTION 'session already exists' USING ERRCODE = '23514';
  END IF;
  INSERT INTO private.trial_event_batches(session_id, user_id, state) VALUES (p_session_id, p_user_id, 'reserved');
  UPDATE public.trial_event_grants SET reserved_batches = reserved_batches + 1 WHERE user_id = p_user_id;
  RETURN p_session_id;
END;
$$;

CREATE FUNCTION private.release_trial_event_batch(p_user_id uuid, p_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.trial_event_grants WHERE user_id = p_user_id FOR UPDATE;
  UPDATE private.trial_event_batches SET state = 'released'
    WHERE session_id = p_session_id AND user_id = p_user_id AND state = 'reserved';
  IF FOUND THEN
    UPDATE public.trial_event_grants SET reserved_batches = reserved_batches - 1 WHERE user_id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.reserve_trial_event_batch(uuid, uuid), private.release_trial_event_batch(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.reserve_trial_event_batch(uuid, uuid), private.release_trial_event_batch(uuid, uuid)
  TO authenticated;
CREATE FUNCTION public.reserve_trial_event_batch(p_user_id uuid, p_session_id uuid) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.reserve_trial_event_batch(p_user_id, p_session_id);
$$;
CREATE FUNCTION public.release_trial_event_batch(p_user_id uuid, p_session_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.release_trial_event_batch(p_user_id, p_session_id);
$$;
REVOKE ALL ON FUNCTION public.reserve_trial_event_batch(uuid, uuid), public.release_trial_event_batch(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_trial_event_batch(uuid, uuid), public.release_trial_event_batch(uuid, uuid)
  TO authenticated;

CREATE FUNCTION private.complete_trial_event_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.trial_event_grants; b private.trial_event_batches; v_plan text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;
  SELECT plan INTO v_plan FROM public.profiles WHERE id = NEW.user_id;
  IF v_plan IS DISTINCT FROM 'trial-event' AND NOT EXISTS (
    SELECT 1 FROM private.trial_event_batches WHERE session_id = NEW.id AND user_id = NEW.user_id AND state = 'reserved'
  ) THEN RETURN NEW; END IF;
  SELECT * INTO g FROM public.trial_event_grants WHERE user_id = NEW.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trial_event_expired' USING ERRCODE = '23514'; END IF;
  SELECT * INTO b FROM private.trial_event_batches WHERE session_id = NEW.id;
  IF FOUND THEN
    IF b.user_id <> NEW.user_id OR b.state = 'released' THEN
      RAISE EXCEPTION 'invalid trial event reservation' USING ERRCODE = '23514';
    END IF;
    IF b.state = 'completed' THEN
      -- BEFORE INSERT also runs for ON CONFLICT DO NOTHING retries.
      IF NOT EXISTS (SELECT 1 FROM public.roast_sessions WHERE id = NEW.id AND user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'completed trial event batch was deleted' USING ERRCODE = '23514';
      END IF;
    ELSE
      UPDATE public.trial_event_grants SET reserved_batches = reserved_batches - 1, used_batches = used_batches + 1
        WHERE user_id = NEW.user_id;
    END IF;
    UPDATE private.trial_event_batches SET state = 'completed', completed_xid = txid_current() WHERE session_id = NEW.id;
  ELSE
    -- Existing import/save clients can finish while the trial is still active.
    -- A reservation is required to finish after expiry or after all slots are held.
    IF clock_timestamp() >= g.ends_at THEN RAISE EXCEPTION 'trial_event_expired' USING ERRCODE = '23514'; END IF;
    IF g.used_batches + g.reserved_batches >= 100 THEN
      RAISE EXCEPTION 'trial_event_batch_cap' USING ERRCODE = '23514';
    END IF;
    INSERT INTO private.trial_event_batches(session_id, user_id, state, completed_xid)
      VALUES (NEW.id, NEW.user_id, 'completed', txid_current());
    UPDATE public.trial_event_grants SET used_batches = used_batches + 1 WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.complete_trial_event_batch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_00_trial_event_batch BEFORE INSERT OR UPDATE ON public.roast_sessions
  FOR EACH ROW EXECUTE FUNCTION private.complete_trial_event_batch();

CREATE OR REPLACE FUNCTION public.profile_write_error(p_user_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_plan text; v_created timestamptz; g public.trial_event_grants;
BEGIN
  SELECT plan, created_at INTO v_plan, v_created FROM public.profiles WHERE id = p_user_id;
  IF v_plan = 'read_only' THEN RETURN 'read_only_plan'; END IF;
  IF v_plan = 'trial-event' THEN
    -- Only a trusted trigger can write this transaction marker. It permits the
    -- admitted roast's atomic stock/progress writes even on its final batch.
    IF EXISTS (SELECT 1 FROM private.trial_event_batches
      WHERE user_id = p_user_id AND state = 'completed' AND completed_xid = txid_current()) THEN RETURN NULL; END IF;
    SELECT * INTO g FROM public.trial_event_grants WHERE user_id = p_user_id;
    IF NOT FOUND OR clock_timestamp() >= g.ends_at THEN RETURN 'trial_event_expired'; END IF;
    IF g.used_batches >= 100 THEN RETURN 'trial_event_batch_cap'; END IF;
  END IF;
  IF v_plan = 'trial' THEN
    IF now() > v_created + interval '14 days' THEN RETURN 'trial_expired'; END IF;
    IF (SELECT count(*) FROM public.roast_sessions WHERE user_id = p_user_id AND status = 'completed') >= 20 THEN
      RETURN 'trial_batch_cap';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_batch_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE gate_err text; owner_plan text; used int; cap int := 200; month_start timestamptz; month_end timestamptz;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;
  gate_err := public.profile_write_error(NEW.user_id);
  IF gate_err IS NOT NULL THEN RAISE EXCEPTION '%', gate_err USING ERRCODE = '23514'; END IF;
  SELECT plan INTO owner_plan FROM public.profiles WHERE id = NEW.user_id;
  IF owner_plan IN ('trial', 'trial-event', 'pro_plus', 'tester', 'enterprise', 'team') THEN RETURN NEW; END IF;
  month_start := date_trunc('month', timezone('utc', now()));
  month_end := month_start + interval '1 month';
  SELECT count(*)::int INTO used FROM public.roast_sessions
    WHERE user_id = NEW.user_id AND status = 'completed' AND roasted_at >= month_start AND roasted_at < month_end
      AND (TG_OP = 'INSERT' OR id IS DISTINCT FROM NEW.id);
  IF used >= cap THEN
    RAISE EXCEPTION 'monthly_batch_cap_exceeded' USING ERRCODE = '23514',
      DETAIL = format('used=%s cap=%s plan=%s', used, cap, coalesce(owner_plan, 'null'));
  END IF;
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
     AND EXISTS (SELECT 1 FROM private.trial_event_batches WHERE user_id = v_user AND session_id = NEW.id AND state = 'completed')
  THEN RETURN NEW; END IF;
  gate_err := public.profile_write_error(v_user);
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

  -- Finishing the derived progress of a committed event roast is allowed after
  -- expiry. Only status may change, and the saved sessions must prove completion.
  IF TG_OP = 'UPDATE' AND NEW.status = 'done' AND OLD.status <> 'cancelled'
     AND NEW.exception_type IS DISTINCT FROM 'cancelled'
     AND (to_jsonb(NEW) - ARRAY['status','updated_at']) IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status','updated_at'])
     AND EXISTS (SELECT 1 FROM private.trial_event_batches e JOIN public.roast_sessions r ON r.id = e.session_id
       WHERE e.user_id = v_user AND e.state = 'completed' AND r.plan_batch_id = NEW.id)
     AND (SELECT count(*) FROM public.roast_sessions WHERE plan_batch_id = NEW.id AND status = 'completed') >= NEW.batch_count
  THEN RETURN NEW; END IF;

  gate_err := public.profile_write_error(v_user);
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
