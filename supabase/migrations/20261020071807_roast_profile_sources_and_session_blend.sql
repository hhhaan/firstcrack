-- Multiple registered roast sources; the old defaults remain compatible with single-source clients.
CREATE TABLE public.roast_profile_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.roast_profiles(id) ON DELETE CASCADE,
  bean_id uuid REFERENCES public.beans(id) ON DELETE CASCADE,
  blend_id uuid REFERENCES public.blends(id) ON DELETE CASCADE,
  CONSTRAINT roast_profile_sources_one_source CHECK (num_nonnulls(bean_id, blend_id) = 1),
  UNIQUE (profile_id, bean_id),
  UNIQUE (profile_id, blend_id)
);
CREATE INDEX roast_profile_sources_bean_id_idx ON public.roast_profile_sources(bean_id) WHERE bean_id IS NOT NULL;
CREATE INDEX roast_profile_sources_blend_id_idx ON public.roast_profile_sources(blend_id) WHERE blend_id IS NOT NULL;
ALTER TABLE public.roast_profile_sources ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roast_profile_sources TO authenticated;
CREATE POLICY roast_profile_sources_workspace ON public.roast_profile_sources
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.roast_profiles p WHERE p.id = profile_id AND public.has_workspace_access(p.user_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.roast_profiles p WHERE p.id = profile_id AND public.has_workspace_access(p.user_id)
    AND (bean_id IS NULL OR EXISTS (SELECT 1 FROM public.beans b WHERE b.id = bean_id AND b.user_id = p.user_id))
    AND (blend_id IS NULL OR EXISTS (SELECT 1 FROM public.blends b WHERE b.id = blend_id AND b.user_id = p.user_id))));
INSERT INTO public.roast_profile_sources(profile_id, bean_id)
  SELECT id, default_bean_id FROM public.roast_profiles WHERE default_bean_id IS NOT NULL;
INSERT INTO public.roast_profile_sources(profile_id, blend_id)
  SELECT id, default_blend_id FROM public.roast_profiles WHERE default_blend_id IS NOT NULL;

-- Profile metadata and its registered sources are committed together.
CREATE FUNCTION public.save_roast_profile_sources(p_profile jsonb, p_sources jsonb, p_id uuid DEFAULT NULL)
RETURNS public.roast_profiles LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_profile public.roast_profiles;
  v_source jsonb;
  v_source_count integer;
  v_only_source public.roast_profile_sources;
BEGIN
  IF jsonb_typeof(p_sources) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'sources must be an array' USING ERRCODE = '22023'; END IF;
  IF p_id IS NULL THEN
    v_profile := jsonb_populate_record(NULL::public.roast_profiles,
      p_profile || jsonb_build_object('id', gen_random_uuid(), 'created_at', now(), 'updated_at', now()));
    INSERT INTO public.roast_profiles SELECT (v_profile).* RETURNING * INTO v_profile;
  ELSE
    SELECT * INTO v_profile FROM public.roast_profiles WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile not found'; END IF;
    v_profile := jsonb_populate_record(v_profile, p_profile - 'id' - 'user_id' - 'created_at' - 'updated_at');
    UPDATE public.roast_profiles SET
      name = v_profile.name, description = v_profile.description, target_level = v_profile.target_level,
      heater_events = v_profile.heater_events,
      default_bean_id = v_profile.default_bean_id, default_blend_id = v_profile.default_blend_id
      WHERE id = p_id RETURNING * INTO v_profile;
  END IF;
  DELETE FROM public.roast_profile_sources WHERE profile_id = v_profile.id;
  FOR v_source IN SELECT value FROM jsonb_array_elements(p_sources) LOOP
    INSERT INTO public.roast_profile_sources(profile_id, bean_id, blend_id)
      VALUES(v_profile.id, NULLIF(v_source->>'bean_id', '')::uuid, NULLIF(v_source->>'blend_id', '')::uuid)
      ON CONFLICT DO NOTHING;
  END LOOP;
  SELECT count(*) INTO v_source_count FROM public.roast_profile_sources WHERE profile_id = v_profile.id;
  SELECT * INTO v_only_source FROM public.roast_profile_sources WHERE profile_id = v_profile.id LIMIT 1;
  -- Only a single registered source can be expressed by legacy defaults.
  UPDATE public.roast_profiles SET
    default_bean_id = CASE WHEN v_source_count = 1 THEN v_only_source.bean_id END,
    default_blend_id = CASE WHEN v_source_count = 1 THEN v_only_source.blend_id END
    WHERE id = v_profile.id RETURNING * INTO v_profile;
  RETURN v_profile;
END;
$$;
REVOKE ALL ON FUNCTION public.save_roast_profile_sources(jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_roast_profile_sources(jsonb, jsonb, uuid) TO authenticated;

ALTER TABLE public.roast_sessions ADD COLUMN blend_id uuid REFERENCES public.blends(id) ON DELETE SET NULL;
ALTER TABLE public.roast_sessions ADD CONSTRAINT roast_sessions_one_inventory_source CHECK (num_nonnulls(bean_id, blend_id) <= 1);
UPDATE public.roast_sessions s SET blend_id = b.blend_id FROM public.roast_plan_batches b
  WHERE s.plan_batch_id = b.id AND b.blend_id IS NOT NULL AND s.bean_id IS NULL;

CREATE FUNCTION public.validate_roast_session_blend() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.blend_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.blends b WHERE b.id = NEW.blend_id AND b.user_id = NEW.user_id
  ) THEN RAISE EXCEPTION 'blend owner mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_roast_session_blend() FROM PUBLIC;
CREATE TRIGGER validate_roast_session_blend BEFORE INSERT OR UPDATE OF blend_id, user_id ON public.roast_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_roast_session_blend();

CREATE INDEX roast_sessions_blend_id_idx ON public.roast_sessions(blend_id) WHERE blend_id IS NOT NULL;

CREATE OR REPLACE FUNCTION save_roast_op(
  p_session jsonb,
  p_deduct boolean,
  p_deduction_grams integer,
  p_inbound_grams integer,
  p_inbound_is_estimate boolean
)
RETURNS roast_sessions
LANGUAGE plpgsql
SECURITY INVOKER
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

CREATE OR REPLACE FUNCTION upsert_roasted_inbound(
  p_session_id uuid, p_user_id uuid, p_grams integer, p_is_estimate boolean
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_bean_id uuid;
  v_blend_id uuid;
  v_batch_id uuid;
BEGIN
  IF p_grams <= 0 THEN RETURN; END IF;

  SELECT s.bean_id, COALESCE(s.blend_id, b.blend_id), s.plan_batch_id INTO v_bean_id, v_blend_id, v_batch_id
  FROM roast_sessions s
  LEFT JOIN roast_plan_batches b ON b.id = s.plan_batch_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM roasted_stock_events
    WHERE reference_id = v_batch_id AND event_type = 'roast_inbound'
  ) THEN RETURN; END IF;

  IF v_blend_id IS NOT NULL THEN
    v_bean_id := NULL;
  ELSIF v_bean_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by)
  VALUES (p_user_id, v_bean_id, v_blend_id, p_grams, 'roast_inbound', p_session_id, p_is_estimate, auth.uid())
  ON CONFLICT (reference_id) WHERE event_type = 'roast_inbound'
  DO UPDATE SET delta_grams = EXCLUDED.delta_grams, is_estimate = EXCLUDED.is_estimate;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_roasted_inbound(uuid, uuid, integer, boolean) TO authenticated;

