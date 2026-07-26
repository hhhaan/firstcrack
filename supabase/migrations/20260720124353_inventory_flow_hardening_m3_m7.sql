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

CREATE UNIQUE INDEX IF NOT EXISTS roasted_adjust_ref_unique
  ON roasted_stock_events(reference_id)
  WHERE event_type IN ('adjustment', 'write_off') AND reference_id IS NOT NULL;
