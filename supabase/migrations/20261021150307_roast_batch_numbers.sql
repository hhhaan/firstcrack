-- Server-assigned save order; editable titles never determine a batch number.
-- skip-grant-check: private counters are writable only through the ownership-checked insert trigger.
ALTER TABLE public.roast_sessions
  ADD COLUMN profile_batch_number bigint,
  ADD COLUMN total_batch_number bigint,
  ADD CONSTRAINT roast_sessions_profile_batch_number_valid
    CHECK (profile_batch_number BETWEEN 1 AND 9007199254740991),
  ADD CONSTRAINT roast_sessions_total_batch_number_valid
    CHECK (total_batch_number BETWEEN 1 AND 9007199254740991);
COMMENT ON COLUMN public.roast_sessions.profile_batch_number IS
  'Workspace/profile save sequence assigned in the save transaction; immutable after completion.';
COMMENT ON COLUMN public.roast_sessions.total_batch_number IS
  'Workspace save sequence assigned in the save transaction; immutable after completion.';

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.roast_batch_counters (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.roast_profiles(id) ON DELETE CASCADE,
  last_number bigint NOT NULL CHECK (last_number BETWEEN 1 AND 9007199254740991),
  UNIQUE NULLS NOT DISTINCT (user_id, profile_id)
);
ALTER TABLE private.roast_batch_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.roast_batch_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.roast_batch_counters TO service_role;
COMMENT ON COLUMN private.roast_batch_counters.profile_id IS 'Null is the workspace-wide sequence.';

-- Continue from saved history without inventing numbers for legacy rows.
INSERT INTO private.roast_batch_counters (user_id, profile_id, last_number)
  SELECT user_id, NULL, count(*) FROM public.roast_sessions
  WHERE status = 'completed' GROUP BY user_id;
INSERT INTO private.roast_batch_counters (user_id, profile_id, last_number)
  SELECT user_id, profile_id, count(*) FROM public.roast_sessions
  WHERE status = 'completed' AND profile_id IS NOT NULL GROUP BY user_id, profile_id;

-- Definer privileges are limited to private counter writes, never session or stock writes.
CREATE FUNCTION private.assign_roast_batch_numbers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existing public.roast_sessions;
BEGIN
  NEW.profile_batch_number := NULL;
  NEW.total_batch_number := NULL;
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT public.has_workspace_access(NEW.user_id) THEN
    RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
  END IF;
  IF NEW.profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.roast_profiles WHERE id = NEW.profile_id AND user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'profile owner mismatch' USING ERRCODE = '23514'; END IF;

  -- Concurrent retries of one UUID must not consume a second sequence value.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('roast-number:' || NEW.id::text, 0));
  SELECT * INTO v_existing FROM public.roast_sessions WHERE id = NEW.id;
  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'session owner mismatch' USING ERRCODE = '42501';
    END IF;
    NEW.profile_batch_number := v_existing.profile_batch_number;
    NEW.total_batch_number := v_existing.total_batch_number;
    RETURN NEW;
  END IF;

  INSERT INTO private.roast_batch_counters AS c (user_id, profile_id, last_number)
    VALUES (NEW.user_id, NULL, 1)
    ON CONFLICT (user_id, profile_id) DO UPDATE SET last_number = c.last_number + 1
    RETURNING last_number INTO NEW.total_batch_number;
  IF NEW.profile_id IS NOT NULL THEN
    INSERT INTO private.roast_batch_counters AS c (user_id, profile_id, last_number)
      VALUES (NEW.user_id, NEW.profile_id, 1)
      ON CONFLICT (user_id, profile_id) DO UPDATE SET last_number = c.last_number + 1
      RETURNING last_number INTO NEW.profile_batch_number;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.assign_roast_batch_numbers() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER assign_roast_batch_numbers BEFORE INSERT ON public.roast_sessions
  FOR EACH ROW EXECUTE FUNCTION private.assign_roast_batch_numbers();

CREATE FUNCTION private.guard_saved_roast_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'completed' AND (
    NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.profile_batch_number IS DISTINCT FROM OLD.profile_batch_number
    OR NEW.total_batch_number IS DISTINCT FROM OLD.total_batch_number
    OR (NEW.profile_id IS DISTINCT FROM OLD.profile_id AND NOT (
      -- Preserve the existing ON DELETE SET NULL behavior when a profile is removed.
      NEW.profile_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.roast_profiles WHERE id = OLD.profile_id)
    ))
  ) THEN
    RAISE EXCEPTION 'saved roast profile and numbers are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_saved_roast_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_saved_roast_identity BEFORE UPDATE ON public.roast_sessions
  FOR EACH ROW EXECUTE FUNCTION private.guard_saved_roast_identity();

CREATE OR REPLACE FUNCTION save_roast_op(
  p_session jsonb,
  p_deduct boolean,
  p_deduction_grams integer,
  p_inbound_grams integer,
  p_inbound_is_estimate boolean
)
RETURNS public.roast_sessions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session roast_sessions;
  v_id uuid;
  v_blend_id uuid;
  v_bean_id uuid;
  v_user_id uuid;
  v_blend_name text;
  v_allocated integer := 0;
  v_grams integer;
  v_comp record;
  v_count integer;
  v_i integer := 0;
  v_plan_batch_text text;
  v_batch_owner uuid;
  v_rule_id uuid;
  v_batch roast_plan_batches;
  v_rule recurrence_rules;
  v_numbering text := COALESCE(p_session->>'batch_title_numbering', 'none');
  v_suffix text;
BEGIN
  v_user_id := (p_session->>'user_id')::uuid;
  IF v_user_id IS NULL OR NOT public.has_workspace_access(v_user_id) THEN
    RAISE EXCEPTION 'workspace access denied';
  END IF;

  v_id := NULLIF(p_session->>'id', '')::uuid;

  -- Retry of a committed save: side-effects were part of that TX — return as-is.
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_session FROM roast_sessions WHERE id = v_id;
    IF FOUND THEN
      IF v_session.user_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'session owner mismatch';
      END IF;
      RETURN v_session;
    END IF;
  END IF;

  -- NEW session only.
  v_plan_batch_text := NULLIF(p_session->>'plan_batch_id', '');
  IF v_plan_batch_text IS NOT NULL THEN
    IF v_plan_batch_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid plan_batch_id' USING ERRCODE = '22P02';
    END IF;

    -- Observe the link, then always lock rule before batch. If the link changed
    -- meanwhile, abort instead of acquiring another rule lock in reverse order.
    SELECT recurrence_rule_id INTO v_rule_id FROM roast_plan_batches
      WHERE id = v_plan_batch_text::uuid;
    IF v_rule_id IS NOT NULL THEN
      SELECT * INTO v_rule FROM recurrence_rules WHERE id = v_rule_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'plan recurrence not found'; END IF;
    END IF;
    SELECT * INTO v_batch FROM roast_plan_batches
      WHERE id = v_plan_batch_text::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'plan batch not found'; END IF;
    IF v_batch.recurrence_rule_id IS DISTINCT FROM v_rule_id THEN
      RAISE EXCEPTION 'plan recurrence changed; retry required' USING ERRCODE = '40001';
    END IF;
    SELECT user_id INTO v_batch_owner FROM roast_day_plans WHERE id = v_batch.plan_id FOR SHARE;
    IF v_batch_owner IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'plan batch owner mismatch';
    END IF;
    -- The client resolved these inventory identities before entering this TX.
    -- Check them under the batch lock; a concurrent edit must never redirect stock.
    -- Keys are optional for older clients, JSON null means an expected null identity.
    IF (p_session ? 'expected_plan_bean_id' AND v_batch.bean_id IS DISTINCT FROM
        NULLIF(p_session->>'expected_plan_bean_id', '')::uuid)
       OR (p_session ? 'expected_plan_blend_id' AND v_batch.blend_id IS DISTINCT FROM
        NULLIF(p_session->>'expected_plan_blend_id', '')::uuid) THEN
      RAISE EXCEPTION 'plan batch bean or blend changed; confirm actual roast inventory'
        USING ERRCODE = '23514';
    END IF;
    IF v_batch.exception_type = 'cancelled' OR v_batch.status = 'cancelled' THEN
      RAISE EXCEPTION 'plan batch cancelled';
    END IF;
    IF v_rule_id IS NOT NULL AND (
      v_rule.user_id IS DISTINCT FROM v_user_id OR v_rule.status <> 'active'
      OR v_batch.original_date IS NULL OR v_batch.original_date < v_rule.dtstart
      OR (v_rule.until IS NOT NULL AND v_batch.original_date > v_rule.until)
    ) THEN
      RAISE EXCEPTION 'plan recurrence cancelled or ended';
    END IF;
  END IF;

  v_blend_id := CASE WHEN v_plan_batch_text IS NOT NULL THEN v_batch.blend_id
                     ELSE NULLIF(p_session->>'blend_id', '')::uuid END;
  IF v_blend_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.blends WHERE id = v_blend_id AND user_id = v_user_id
  ) THEN RAISE EXCEPTION 'blend owner mismatch' USING ERRCODE = '23514'; END IF;
  IF v_blend_id IS NOT NULL AND NULLIF(p_session->>'bean_id', '') IS NOT NULL THEN
    RAISE EXCEPTION 'select one inventory source' USING ERRCODE = '23514';
  END IF;

  INSERT INTO roast_sessions (
    id, user_id, weight_grams, output_weight_grams, status, roasted_at, duration_seconds,
    drop_temp_celsius, roast_level, scheduled_at, notes,
    ambient_temp_celsius, ambient_humidity_pct, bean_id, blend_id, bean_label, batch_name, profile_id,
    tsv_path, bbp_tsv_path, bbp_seconds, charge_temp_celsius, plan_batch_id, events,
    color_whole, color_ground,
    machine_id, machine_name, machine_roaster_key, machine_brand, machine_protocol,
    created_by
  ) VALUES (
    COALESCE(v_id, gen_random_uuid()),
    v_user_id,
    (p_session->>'weight_grams')::integer,
    NULLIF(p_session->>'output_weight_grams', '')::integer,
    COALESCE(p_session->>'status', 'completed'),
    NULLIF(p_session->>'roasted_at', '')::timestamptz,
    round(NULLIF(p_session->>'duration_seconds', '')::numeric)::integer,
    NULLIF(p_session->>'drop_temp_celsius', '')::integer,
    NULLIF(p_session->>'roast_level', ''),
    NULLIF(p_session->>'scheduled_at', '')::timestamptz,
    NULLIF(p_session->>'notes', ''),
    NULLIF(p_session->>'ambient_temp_celsius', '')::numeric,
    NULLIF(p_session->>'ambient_humidity_pct', '')::numeric,
    NULLIF(p_session->>'bean_id', '')::uuid,
    v_blend_id,
    NULLIF(trim(COALESCE(p_session->>'bean_label', '')), ''),
    NULLIF(trim(COALESCE(p_session->>'batch_name', '')), ''),
    NULLIF(p_session->>'profile_id', '')::uuid,
    NULLIF(p_session->>'tsv_path', ''),
    NULLIF(p_session->>'bbp_tsv_path', ''),
    NULLIF(p_session->>'bbp_seconds', '')::integer,
    NULLIF(p_session->>'charge_temp_celsius', '')::integer,
    NULLIF(p_session->>'plan_batch_id', '')::uuid,
    COALESCE(p_session->'events', '[]'::jsonb),
    NULLIF(trim(COALESCE(p_session->>'color_whole', '')), ''),
    NULLIF(trim(COALESCE(p_session->>'color_ground', '')), ''),
    NULLIF(p_session->>'machine_id', ''),
    NULLIF(p_session->>'machine_name', ''),
    NULLIF(p_session->>'machine_roaster_key', ''),
    NULLIF(p_session->>'machine_brand', ''),
    NULLIF(p_session->>'machine_protocol', ''),
    auth.uid()
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_session;

  -- Lost a concurrent race on the same id — winner owns the side-effects.
  IF v_session.id IS NULL THEN
    SELECT * INTO v_session FROM roast_sessions WHERE id = v_id;
    IF v_session.id IS NULL THEN
      RAISE EXCEPTION 'session id conflict';
    END IF;
    IF v_session.user_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'session owner mismatch';
    END IF;
    RETURN v_session;
  END IF;

  IF v_numbering NOT IN ('profile', 'total', 'both', 'none') THEN
    RAISE EXCEPTION 'invalid batch title numbering' USING ERRCODE = '22023';
  END IF;
  v_suffix := concat_ws(' · ',
    CASE WHEN v_numbering IN ('profile', 'both') AND v_session.profile_batch_number IS NOT NULL
      THEN '#' || v_session.profile_batch_number END,
    CASE WHEN v_numbering IN ('total', 'both')
      THEN 'Σ#' || v_session.total_batch_number END);
  IF v_suffix <> '' THEN
    UPDATE public.roast_sessions
      SET batch_name = left(COALESCE(v_session.batch_name, 'Roast'), 120 - char_length(v_suffix) - 1) || ' ' || v_suffix
      WHERE id = v_session.id RETURNING * INTO v_session;
  END IF;

  IF COALESCE(p_deduct, false)
     AND COALESCE(p_deduction_grams, 0) > 0
     AND NOT roast_deduction_blocked(v_session.id)
  THEN
    v_bean_id := v_session.bean_id;
    v_blend_id := v_session.blend_id;

    IF v_session.plan_batch_id IS NOT NULL THEN
      SELECT blend_id INTO v_blend_id
      FROM roast_plan_batches
      WHERE id = v_session.plan_batch_id;
    END IF;

    IF v_blend_id IS NOT NULL THEN
      SELECT count(*)::int INTO v_count
      FROM blend_components
      WHERE blend_id = v_blend_id;

      IF v_count = 0 THEN
        RAISE EXCEPTION 'blend has no components';
      END IF;

      SELECT name INTO v_blend_name FROM blends WHERE id = v_blend_id;

      FOR v_comp IN
        SELECT bean_id, ratio_pct
        FROM blend_components
        WHERE blend_id = v_blend_id
        ORDER BY bean_id
      LOOP
        v_i := v_i + 1;
        IF v_i = v_count THEN
          v_grams := p_deduction_grams - v_allocated;
        ELSE
          v_grams := round(p_deduction_grams * (v_comp.ratio_pct / 100.0))::integer;
        END IF;
        v_allocated := v_allocated + v_grams;

        IF v_grams > 0 THEN
          INSERT INTO bean_stock_events (
            user_id, bean_id, delta_grams, event_type, reference_id, note, created_by
          ) VALUES (
            v_user_id, v_comp.bean_id, -v_grams, 'roast', v_session.id,
            COALESCE(v_blend_name, 'blend') || ' 블렌드 차감',
            auth.uid()
          )
          ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
        END IF;
      END LOOP;
    ELSIF v_bean_id IS NOT NULL THEN
      INSERT INTO bean_stock_events (
        user_id, bean_id, delta_grams, event_type, reference_id, created_by
      ) VALUES (
        v_user_id, v_bean_id, -p_deduction_grams, 'roast', v_session.id, auth.uid()
      )
      ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  IF COALESCE(p_inbound_grams, 0) > 0 THEN
    PERFORM upsert_roasted_inbound(v_session.id, v_user_id, p_inbound_grams,
                                   COALESCE(p_inbound_is_estimate, false));
  END IF;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION save_roast_op(jsonb, boolean, integer, integer, boolean) TO authenticated;
