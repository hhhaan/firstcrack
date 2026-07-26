-- Add created_by to roasted_stock_events (skipped earlier because table was missing)
ALTER TABLE public.roasted_stock_events
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.roasted_stock_events ALTER COLUMN created_by SET DEFAULT auth.uid();

CREATE OR REPLACE FUNCTION insert_roasted_stock_events_batch(p_events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate, created_by)
  SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
         (e->>'delta_grams')::integer, e->>'event_type', (e->>'reference_id')::uuid,
         e->>'note', COALESCE((e->>'is_estimate')::boolean, false),
         COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid())
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION insert_packaging_op(p_product_events jsonb, p_roasted_events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note, created_by)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'product_id')::uuid,
    (e->>'delta_units')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', ''),
    COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid())
  FROM jsonb_array_elements(p_product_events) AS e
  ON CONFLICT DO NOTHING;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate, created_by)
  SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
         (e->>'delta_grams')::integer, e->>'event_type', (e->>'reference_id')::uuid,
         e->>'note', COALESCE((e->>'is_estimate')::boolean, false),
         COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid())
  FROM jsonb_array_elements(p_roasted_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;

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
