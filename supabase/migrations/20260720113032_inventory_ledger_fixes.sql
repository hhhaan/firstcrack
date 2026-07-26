-- Inventory ledger 수정 3건: F1 워크스페이스 RLS, F2 포장 원자성+멱등, F4 입고 귀속 서버 결정.

-- ── F1. roasted_stock_events RLS 워크스페이스 적용 ──────────────────────────
-- bean_stock_events 정책 미러: USING has_workspace_access + WITH CHECK 소유권 EXISTS.
-- single_source CHECK로 bean_id/blend_id 중 정확히 하나만 non-null.

DROP POLICY IF EXISTS "users see own roasted stock events" ON public.roasted_stock_events;
CREATE POLICY "users see own roasted stock events" ON public.roasted_stock_events
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (
    public.has_workspace_access(user_id)
    AND (
      (roasted_stock_events.bean_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.beans
        WHERE beans.id = roasted_stock_events.bean_id
          AND public.has_workspace_access(beans.user_id)
      ))
      OR
      (roasted_stock_events.blend_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.blends
        WHERE blends.id = roasted_stock_events.blend_id
          AND public.has_workspace_access(blends.user_id)
      ))
    )
  );

-- ── F2. 포장/블렌드 멱등 인덱스 + 배치 ON CONFLICT + 단일 트랜잭션 RPC ─────

-- 재시도 이중 차감 방지: 작업 단위 reference_id에 partial unique
CREATE UNIQUE INDEX IF NOT EXISTS roasted_packaging_ref_unique
  ON roasted_stock_events(reference_id) WHERE event_type = 'packaging';
CREATE UNIQUE INDEX IF NOT EXISTS roasted_blend_produce_ref_unique
  ON roasted_stock_events(reference_id) WHERE event_type = 'blend_produce';
CREATE UNIQUE INDEX IF NOT EXISTS roasted_blend_consume_ref_unique
  ON roasted_stock_events(reference_id, bean_id) WHERE event_type = 'blend_consume';

-- 배치 insert 멱등화 (신규 인덱스 하에서 재시도 안전)
CREATE OR REPLACE FUNCTION insert_roasted_stock_events_batch(p_events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate)
  SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
         (e->>'delta_grams')::integer, e->>'event_type', (e->>'reference_id')::uuid,
         e->>'note', COALESCE((e->>'is_estimate')::boolean, false)
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;

-- 포장 = product +units 와 roasted -grams 를 한 트랜잭션으로.
-- p_roasted_events는 빈 배열 허용 (merch 상품은 roasted 차감 없음).
CREATE OR REPLACE FUNCTION insert_packaging_op(p_product_events jsonb, p_roasted_events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'product_id')::uuid,
    (e->>'delta_units')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', '')
  FROM jsonb_array_elements(p_product_events) AS e
  ON CONFLICT DO NOTHING;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate)
  SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
         (e->>'delta_grams')::integer, e->>'event_type', (e->>'reference_id')::uuid,
         e->>'note', COALESCE((e->>'is_estimate')::boolean, false)
  FROM jsonb_array_elements(p_roasted_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_packaging_op(jsonb, jsonb) TO authenticated;

-- ── F4. 입고 귀속 서버 결정 ─────────────────────────────────────────────────
-- 클라이언트가 bean/blend를 넘기던 시그니처 폐기 — 세션/배치에서 서버가 해석.

DROP FUNCTION IF EXISTS upsert_roasted_inbound(uuid, uuid, uuid, uuid, integer, boolean);

CREATE OR REPLACE FUNCTION upsert_roasted_inbound(
  p_session_id uuid, p_user_id uuid, p_grams integer, p_is_estimate boolean
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_bean_id uuid;
  v_blend_id uuid;
BEGIN
  IF p_grams <= 0 THEN RETURN; END IF;

  SELECT s.bean_id, b.blend_id INTO v_bean_id, v_blend_id
  FROM roast_sessions s
  LEFT JOIN roast_plan_batches b ON b.id = s.plan_batch_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN RETURN; END IF;

  -- 블렌드 배치 우선, 아니면 단일 원두, 둘 다 없으면 no-op
  IF v_blend_id IS NOT NULL THEN
    v_bean_id := NULL;
  ELSIF v_bean_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate)
  VALUES (p_user_id, v_bean_id, v_blend_id, p_grams, 'roast_inbound', p_session_id, p_is_estimate)
  ON CONFLICT (reference_id) WHERE event_type = 'roast_inbound'
  DO UPDATE SET delta_grams = EXCLUDED.delta_grams, is_estimate = EXCLUDED.is_estimate;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_roasted_inbound(uuid, uuid, integer, boolean) TO authenticated;
