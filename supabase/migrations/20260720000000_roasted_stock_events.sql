-- Loose roasted (벌크 원두) 원장 — bean_stock_events 패턴 미러.
-- 유연 원칙: 음수 잔량 허용(합계 제약 없음), 이벤트 append-only, 입고만 upsert RPC 경유.

CREATE TABLE roasted_stock_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bean_id      uuid REFERENCES beans(id) ON DELETE CASCADE,
  blend_id     uuid REFERENCES blends(id) ON DELETE CASCADE,
  delta_grams  integer NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN
    ('roast_inbound', 'packaging', 'blend_consume', 'blend_produce', 'adjustment', 'write_off')),
  -- roast_inbound: roast_session.id / packaging·blend_*: 작업 단위 uuid / adjustment: null 허용
  reference_id uuid,
  note         text,
  is_estimate  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_source CHECK (num_nonnulls(bean_id, blend_id) = 1),
  CONSTRAINT delta_sign CHECK (
    (event_type IN ('roast_inbound', 'blend_produce') AND delta_grams > 0)
    OR (event_type IN ('packaging', 'blend_consume', 'write_off') AND delta_grams < 0)
    OR (event_type = 'adjustment' AND delta_grams <> 0))
);

-- 한 로스트 세션은 입고 1건 — 추정→실측 교체는 upsert로
CREATE UNIQUE INDEX roasted_inbound_session_unique
  ON roasted_stock_events(reference_id) WHERE event_type = 'roast_inbound';

CREATE INDEX roasted_stock_events_user_idx ON roasted_stock_events(user_id, created_at DESC);

ALTER TABLE roasted_stock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own roasted stock events" ON roasted_stock_events
  FOR ALL USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON roasted_stock_events TO authenticated;

-- 자동 입고 upsert: 추정 입고를 실측으로 교체하는 유일한 경로
CREATE OR REPLACE FUNCTION upsert_roasted_inbound(
  p_session_id uuid, p_user_id uuid, p_bean_id uuid, p_blend_id uuid,
  p_grams integer, p_is_estimate boolean
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate)
  VALUES (p_user_id, p_bean_id, p_blend_id, p_grams, 'roast_inbound', p_session_id, p_is_estimate)
  ON CONFLICT (reference_id) WHERE event_type = 'roast_inbound'
  DO UPDATE SET delta_grams = EXCLUDED.delta_grams, is_estimate = EXCLUDED.is_estimate;
END;
$$;

-- 포장/블렌딩용 원자적 배치 (insert_stock_events_batch 패턴)
CREATE OR REPLACE FUNCTION insert_roasted_stock_events_batch(p_events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate)
  SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
         (e->>'delta_grams')::integer, e->>'event_type', (e->>'reference_id')::uuid,
         e->>'note', COALESCE((e->>'is_estimate')::boolean, false)
  FROM jsonb_array_elements(p_events) AS e;
END;
$$;

-- 잔량 집계: key = 'bean:<uuid>' | 'blend:<uuid>', value = { grams, has_estimate }
CREATE OR REPLACE FUNCTION get_user_roasted_stock(p_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER AS $$
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM (
    SELECT
      CASE WHEN bean_id IS NOT NULL THEN 'bean:' || bean_id ELSE 'blend:' || blend_id END AS k,
      jsonb_build_object(
        'grams', SUM(delta_grams),
        'has_estimate', bool_or(is_estimate AND event_type = 'roast_inbound')
      ) AS v
    FROM roasted_stock_events
    WHERE user_id = p_user_id
    GROUP BY 1
  ) s;
$$;

GRANT EXECUTE ON FUNCTION upsert_roasted_inbound(uuid, uuid, uuid, uuid, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_roasted_stock_events_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_roasted_stock(uuid) TO authenticated;
