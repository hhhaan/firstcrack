-- Idempotent save_roast_op: client passes its session uuid as p_session->>'id'.
-- Retry after an ambiguous failure (timeout after commit, double submit) converges
-- on the already-committed row instead of minting a new session + duplicate
-- deduct/inbound. Downstream dedup (bean_stock_events / roasted inbound) keys on
-- session id, so a stable id makes the whole op idempotent.
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
      RETURN v_session;
    END IF;
  END IF;

  INSERT INTO roast_sessions (
    id, user_id, weight_grams, output_weight_grams, status, roasted_at, duration_seconds,
    drop_temp_celsius, roast_level, scheduled_at, notes,
    ambient_temp_celsius, ambient_humidity_pct, bean_id, bean_label, profile_id,
    tsv_path, bbp_tsv_path, bbp_seconds, charge_temp_celsius, plan_batch_id, events,
    created_by
  ) VALUES (
    COALESCE(v_id, gen_random_uuid()),
    v_user_id,
    (p_session->>'weight_grams')::integer,
    NULLIF(p_session->>'output_weight_grams', '')::integer,
    COALESCE(p_session->>'status', 'completed'),
    NULLIF(p_session->>'roasted_at', '')::timestamptz,
    NULLIF(p_session->>'duration_seconds', '')::integer,
    NULLIF(p_session->>'drop_temp_celsius', '')::integer,
    NULLIF(p_session->>'roast_level', ''),
    NULLIF(p_session->>'scheduled_at', '')::timestamptz,
    NULLIF(p_session->>'notes', ''),
    NULLIF(p_session->>'ambient_temp_celsius', '')::numeric,
    NULLIF(p_session->>'ambient_humidity_pct', '')::numeric,
    NULLIF(p_session->>'bean_id', '')::uuid,
    NULLIF(trim(COALESCE(p_session->>'bean_label', '')), ''),
    NULLIF(p_session->>'profile_id', '')::uuid,
    NULLIF(p_session->>'tsv_path', ''),
    NULLIF(p_session->>'bbp_tsv_path', ''),
    NULLIF(p_session->>'bbp_seconds', '')::integer,
    NULLIF(p_session->>'charge_temp_celsius', '')::integer,
    NULLIF(p_session->>'plan_batch_id', '')::uuid,
    COALESCE(p_session->'events', '[]'::jsonb),
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
    RETURN v_session;
  END IF;

  IF COALESCE(p_deduct, false)
     AND COALESCE(p_deduction_grams, 0) > 0
     AND NOT roast_deduction_blocked(v_session.id)
  THEN
    v_bean_id := v_session.bean_id;
    v_blend_id := NULL;

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
