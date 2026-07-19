-- PR-1: 원장 쓰기 경로 손상 차단 (C1/C2/C4)
-- C4: blend ratio 트리거 예외 + replace_blend_components
-- C2: batch↔session 이중 차감 서버 차단
-- C1: save_roast_op (세션 + 생두 차감 + roasted 입고 단일 TX)

-- ═══════════════════════════════════════════════════════════════════════════
-- C4. blend_components ratio_sum — blend 삭제 CASCADE 허용
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION check_blend_ratio_sum()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_blend_id uuid;
  v_total numeric;
BEGIN
  v_blend_id := COALESCE(NEW.blend_id, OLD.blend_id);

  -- blend 행이 이미 없으면 CASCADE 삭제 중 — 통과
  IF NOT EXISTS (SELECT 1 FROM blends WHERE id = v_blend_id) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(ratio_pct), 0) INTO v_total
  FROM blend_components
  WHERE blend_id = v_blend_id;

  IF v_total <> 100 THEN
    RAISE EXCEPTION 'blend_components ratio_pct must sum to 100 (got %)', v_total;
  END IF;

  RETURN NULL;
END;
$$;

-- 컴포넌트 교체를 한 트랜잭션으로 (deferred 트리거가 최종 sum만 검사)
CREATE OR REPLACE FUNCTION replace_blend_components(p_blend_id uuid, p_components jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM blends b
    WHERE b.id = p_blend_id
      AND public.has_workspace_access(b.user_id)
  ) THEN
    RAISE EXCEPTION 'blend not found or access denied';
  END IF;

  DELETE FROM blend_components WHERE blend_id = p_blend_id;

  INSERT INTO blend_components (blend_id, bean_id, ratio_pct)
  SELECT
    p_blend_id,
    (c->>'bean_id')::uuid,
    (c->>'ratio_pct')::numeric
  FROM jsonb_array_elements(p_components) AS c;
END;
$$;

GRANT EXECUTE ON FUNCTION replace_blend_components(uuid, jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- C2. batch↔session 이중 차감 가드
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION roast_deduction_blocked(p_reference_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_batch_id uuid;
BEGIN
  IF p_reference_id IS NULL THEN
    RETURN false;
  END IF;

  -- reference = plan_batch.id
  IF EXISTS (SELECT 1 FROM roast_plan_batches WHERE id = p_reference_id) THEN
    IF EXISTS (
      SELECT 1 FROM bean_stock_events
      WHERE reference_id = p_reference_id AND event_type = 'roast'
      LIMIT 1
    ) THEN
      RETURN true;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM bean_stock_events e
      JOIN roast_sessions s ON s.id = e.reference_id
      WHERE s.plan_batch_id = p_reference_id
        AND e.event_type = 'roast'
      LIMIT 1
    ) THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  -- reference = roast_session.id → batch-level 일괄 차감만 차단 (동일 세션 재시도는 ON CONFLICT)
  SELECT plan_batch_id INTO v_batch_id
  FROM roast_sessions
  WHERE id = p_reference_id;

  IF v_batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bean_stock_events
    WHERE reference_id = v_batch_id AND event_type = 'roast'
    LIMIT 1
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION roast_deduction_blocked(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION insert_stock_events_batch(p_events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C1. save_roast_op — 세션 + 차감 + 입고 단일 트랜잭션
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

  -- roasted 입고 (테이블 있을 때만; static SQL 금지 — remote에 테이블 없으면 CREATE 실패)
  IF COALESCE(p_inbound_grams, 0) > 0
     AND to_regclass('public.roasted_stock_events') IS NOT NULL
  THEN
    v_bean_id := v_session.bean_id;
    v_blend_id := NULL;

    IF v_session.plan_batch_id IS NOT NULL THEN
      SELECT blend_id INTO v_blend_id
      FROM roast_plan_batches
      WHERE id = v_session.plan_batch_id;
    END IF;

    IF v_blend_id IS NOT NULL THEN
      v_bean_id := NULL;
    END IF;

    IF v_bean_id IS NOT NULL OR v_blend_id IS NOT NULL THEN
      EXECUTE $roasted$
        INSERT INTO roasted_stock_events (
          user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by
        ) VALUES ($1, $2, $3, $4, 'roast_inbound', $5, $6, auth.uid())
        ON CONFLICT (reference_id) WHERE event_type = 'roast_inbound'
        DO UPDATE SET
          delta_grams = EXCLUDED.delta_grams,
          is_estimate = EXCLUDED.is_estimate
      $roasted$
      USING
        v_user_id,
        v_bean_id,
        v_blend_id,
        p_inbound_grams,
        v_session.id,
        COALESCE(p_inbound_is_estimate, false);
    END IF;
  END IF;

  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION save_roast_op(jsonb, boolean, integer, integer, boolean) TO authenticated;

-- service_role may call fulfill_order from order-dispatch edge function
GRANT EXECUTE ON FUNCTION fulfill_order(uuid) TO service_role;
