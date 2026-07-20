-- Inventory flow hardening: batch roasted inbound, unified upsert guards,
-- atomic output weight / cancel order / delete session, adjust idempotency.

-- ═══════════════════════════════════════════════════════════════════════════
-- M1. upsert_roasted_inbound — batch-level roast_inbound blocks session inbound
-- ═══════════════════════════════════════════════════════════════════════════

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

  SELECT s.bean_id, b.blend_id, s.plan_batch_id INTO v_bean_id, v_blend_id, v_batch_id
  FROM roast_sessions s
  LEFT JOIN roast_plan_batches b ON b.id = s.plan_batch_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN RETURN; END IF;

  -- 배치 일괄 입고가 이미 이 세션분을 커버 (C2 green 가드와 대칭)
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

-- ═══════════════════════════════════════════════════════════════════════════
-- M2. save_roast_op — silent skip removed; inbound via upsert_roasted_inbound
-- ═══════════════════════════════════════════════════════════════════════════

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

  INSERT INTO roast_sessions (
    user_id, weight_grams, output_weight_grams, status, roasted_at, duration_seconds,
    drop_temp_celsius, roast_level, scheduled_at, notes,
    ambient_temp_celsius, ambient_humidity_pct, bean_id, profile_id,
    tsv_path, bbp_tsv_path, bbp_seconds, charge_temp_celsius, plan_batch_id, events,
    created_by
  ) VALUES (
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
    NULLIF(p_session->>'profile_id', '')::uuid,
    NULLIF(p_session->>'tsv_path', ''),
    NULLIF(p_session->>'bbp_tsv_path', ''),
    NULLIF(p_session->>'bbp_seconds', '')::integer,
    NULLIF(p_session->>'charge_temp_celsius', '')::integer,
    NULLIF(p_session->>'plan_batch_id', '')::uuid,
    COALESCE(p_session->'events', '[]'::jsonb),
    auth.uid()
  )
  RETURNING * INTO v_session;

  -- 생두 차감 (C2: batch 일괄 차감 있으면 스킵 — 세션/입고는 유지)
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

  -- roasted 입고 (M1 upsert가 귀속·멱등·배치가드 전담; 테이블은 항상 존재해야 함)
  IF COALESCE(p_inbound_grams, 0) > 0 THEN
    PERFORM upsert_roasted_inbound(v_session.id, v_user_id, p_inbound_grams,
                                   COALESCE(p_inbound_is_estimate, false));
  END IF;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION save_roast_op(jsonb, boolean, integer, integer, boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- M3. insert_stock_events_batch — optional roasted events (batch complete path)
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS insert_stock_events_batch(jsonb);

CREATE OR REPLACE FUNCTION insert_stock_events_batch(
  p_events jsonb,
  p_roasted_events jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_ref uuid;
  v_has_roast boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) AS e
    WHERE e->>'event_type' = 'roast'
  ) INTO v_has_roast;

  IF v_has_roast THEN
    SELECT NULLIF(e->>'reference_id', '')::uuid INTO v_ref
    FROM jsonb_array_elements(p_events) AS e
    WHERE e->>'event_type' = 'roast'
    LIMIT 1;

    IF v_ref IS NOT NULL AND roast_deduction_blocked(v_ref) THEN
      RAISE EXCEPTION 'roast_already_deducted'
        USING ERRCODE = 'unique_violation',
              DETAIL = format('reference_id=%s', v_ref);
    END IF;
  END IF;

  INSERT INTO bean_stock_events (user_id, bean_id, delta_grams, event_type, reference_id, note, created_by)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'bean_id')::uuid,
    (e->>'delta_grams')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', ''),
    COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid())
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by)
  SELECT
    (e->>'user_id')::uuid,
    NULLIF(e->>'bean_id', '')::uuid,
    NULLIF(e->>'blend_id', '')::uuid,
    (e->>'delta_grams')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    COALESCE((e->>'is_estimate')::boolean, false),
    auth.uid()
  FROM jsonb_array_elements(p_roasted_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_stock_events_batch(jsonb, jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- M4. set_session_output_weight — atomic session output + roasted inbound
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_session_output_weight(
  p_session_id uuid,
  p_output_grams integer,
  p_inbound_grams integer,
  p_inbound_is_estimate boolean
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_user_id uuid;
BEGIN
  UPDATE roast_sessions
  SET output_weight_grams = p_output_grams
  WHERE id = p_session_id
  RETURNING user_id INTO v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or access denied';
  END IF;

  IF COALESCE(p_inbound_grams, 0) > 0 THEN
    PERFORM upsert_roasted_inbound(p_session_id, v_user_id, p_inbound_grams,
                                   COALESCE(p_inbound_is_estimate, false));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_session_output_weight(uuid, integer, integer, boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- M5. cancel_order — restore product stock for fulfilled lines
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cancel_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id)
  SELECT ol.user_id, ol.product_id, ol.quantity, 'order_cancel', ol.id
  FROM order_lines ol
  WHERE ol.order_id = p_order_id
    AND ol.product_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM product_stock_events pse
      WHERE pse.reference_id = ol.id AND pse.event_type = 'order_fulfillment'
    )
  ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING;

  UPDATE orders SET status = 'cancelled', updated_at = now()
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_order(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- M6. delete_roast_session — remove session-scoped ledger rows + session
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION delete_roast_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  DELETE FROM bean_stock_events    WHERE reference_id = p_session_id AND event_type = 'roast';
  DELETE FROM roasted_stock_events WHERE reference_id = p_session_id AND event_type = 'roast_inbound';
  DELETE FROM roast_sessions       WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_roast_session(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- M7. roasted adjust/write_off idempotency
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS roasted_adjust_ref_unique
  ON roasted_stock_events(reference_id)
  WHERE event_type IN ('adjustment', 'write_off') AND reference_id IS NOT NULL;
