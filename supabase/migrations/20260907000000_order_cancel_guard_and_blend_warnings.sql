-- #306: EF batch order_cancel must not restore stock that was never deducted, and
-- get_roasting_requirements must surface blends with no components instead of dropping them.

CREATE OR REPLACE FUNCTION public.insert_product_stock_events_batch(p_events jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_products    uuid[];
  v_bad_product uuid;
  v_bad_units   integer;
  v_skipped     jsonb := '[]'::jsonb;
BEGIN
  PERFORM 1
  FROM orders o
  WHERE o.id IN (
    SELECT ol.order_id
    FROM order_lines ol
    WHERE ol.id IN (
      SELECT NULLIF(e->>'reference_id', '')::uuid
      FROM jsonb_array_elements(p_events) AS e
      WHERE (e->>'event_type') IN ('order_fulfillment', 'order_cancel')
    )
  )
  ORDER BY o.id
  FOR UPDATE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'reference_id', t.reference_id,
           'order_id', t.order_id,
           'order_status', t.status,
           'reason', t.reason)), '[]'::jsonb)
    INTO v_skipped
  FROM (
    SELECT DISTINCT ol.id AS reference_id, ol.order_id, o.status,
           'order_terminal_not_fulfillable'::text AS reason
    FROM jsonb_array_elements(p_events) AS e
    JOIN order_lines ol ON ol.id = NULLIF(e->>'reference_id', '')::uuid
    JOIN orders o ON o.id = ol.order_id
    WHERE (e->>'event_type') = 'order_fulfillment'
      AND o.status IN ('cancelled', 'refunded')

    UNION ALL

    -- Mirror cancel_order: never insert order_cancel without a prior fulfillment
    -- for that line (unmapped-at-fulfill then mapped-at-cancel phantom restore).
    SELECT DISTINCT ol.id AS reference_id, ol.order_id, o.status,
           'no_prior_fulfillment'::text AS reason
    FROM jsonb_array_elements(p_events) AS e
    JOIN order_lines ol ON ol.id = NULLIF(e->>'reference_id', '')::uuid
    JOIN orders o ON o.id = ol.order_id
    WHERE (e->>'event_type') = 'order_cancel'
      AND NOT EXISTS (
        SELECT 1 FROM product_stock_events pse
        WHERE pse.reference_id = ol.id AND pse.event_type = 'order_fulfillment'
      )
  ) t;

  WITH ev AS (
    SELECT
      (e->>'user_id')::uuid                                    AS user_id,
      (e->>'product_id')::uuid                                 AS product_id,
      (e->>'delta_units')::integer                             AS delta_units,
      (e->>'event_type')::text                                 AS event_type,
      NULLIF(e->>'reference_id', '')::uuid                     AS reference_id,
      NULLIF(e->>'note', '')                                   AS note,
      COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid()) AS created_by
    FROM jsonb_array_elements(p_events) AS e
  ),
  ins AS (
    INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note, created_by)
    SELECT ev.user_id, ev.product_id, ev.delta_units, ev.event_type, ev.reference_id, ev.note, ev.created_by
    FROM ev
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_skipped) AS s
      WHERE (s->>'reference_id')::uuid = ev.reference_id
        AND (
          (ev.event_type = 'order_fulfillment' AND s->>'reason' = 'order_terminal_not_fulfillable')
          OR
          (ev.event_type = 'order_cancel' AND s->>'reason' = 'no_prior_fulfillment')
        )
    )
    ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING
    RETURNING product_id, delta_units
  ),
  call_net AS (
    SELECT product_id, SUM(delta_units) AS call_units
    FROM ins
    GROUP BY product_id
  )
  SELECT array_agg(product_id) FILTER (WHERE call_units < 0)
    INTO v_products
  FROM call_net;

  IF v_products IS NOT NULL THEN
    SELECT pse.product_id, SUM(pse.delta_units)::integer
      INTO v_bad_product, v_bad_units
    FROM product_stock_events pse
    WHERE pse.product_id = ANY (v_products)
    GROUP BY pse.product_id
    HAVING SUM(pse.delta_units) < 0
    LIMIT 1;

    IF v_bad_product IS NOT NULL THEN
      RAISE EXCEPTION 'insufficient_product_stock'
        USING ERRCODE = 'check_violation',
              DETAIL = format('product_id=%s balance_units=%s', v_bad_product, v_bad_units);
    END IF;
  END IF;

  RETURN jsonb_build_object('skipped', v_skipped);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_roasting_requirements(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN (
    WITH demand AS (
      SELECT ol.product_id, SUM(ol.quantity)::integer AS ordered_units
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
      WHERE ol.user_id = p_user_id
        AND ol.status = 'active'
        AND ol.product_id IS NOT NULL
        AND o.status IN ('paid', 'preparing')
        AND o.fulfilled_at IS NULL
      GROUP BY ol.product_id
    ),
    stock AS (
      SELECT product_id, SUM(delta_units)::integer AS units
      FROM product_stock_events
      GROUP BY product_id
    ),
    shortfall AS (
      SELECT
        d.product_id,
        d.ordered_units,
        COALESCE(st.units, 0) AS on_hand_units,
        GREATEST(0, d.ordered_units - COALESCE(st.units, 0)) AS shortfall_units,
        p.name,
        p.bean_id,
        p.blend_id,
        p.roast_profile_id,
        p.net_weight_grams,
        p.yield_pct
      FROM demand d
      JOIN products p ON p.id = d.product_id
      LEFT JOIN stock st ON st.product_id = d.product_id
    ),
    bean_demand AS (
      SELECT
        COALESCE(bc.bean_id, s.bean_id) AS bean_id,
        s.roast_profile_id,
        SUM(
          s.shortfall_units * s.net_weight_grams
          * COALESCE(bc.ratio_pct, 100) / 100
        ) AS roasted_grams,
        SUM(
          s.shortfall_units * s.net_weight_grams
          * COALESCE(bc.ratio_pct, 100) / 100 / s.yield_pct
        ) AS green_grams
      FROM shortfall s
      LEFT JOIN blend_components bc ON bc.blend_id = s.blend_id
      WHERE s.shortfall_units > 0
        AND (s.bean_id IS NOT NULL OR bc.bean_id IS NOT NULL)
      GROUP BY COALESCE(bc.bean_id, s.bean_id), s.roast_profile_id
    )
    SELECT jsonb_build_object(
      'products', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', s.product_id,
          'name', s.name,
          'ordered_units', s.ordered_units,
          'on_hand_units', s.on_hand_units,
          'shortfall_units', s.shortfall_units
        ) ORDER BY s.name)
        FROM shortfall s
      ), '[]'::jsonb),
      'beans', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'bean_id', bd.bean_id,
          'roast_profile_id', bd.roast_profile_id,
          'roasted_grams_needed', ROUND(bd.roasted_grams)::integer,
          'green_grams_needed', ROUND(bd.green_grams)::integer,
          'green_available', get_bean_available_stock(bd.bean_id)
        ))
        FROM bean_demand bd
      ), '[]'::jsonb),
      'warnings', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', s.product_id,
          'name', s.name,
          'reason', 'blend_missing_components'
        ) ORDER BY s.name)
        FROM shortfall s
        WHERE s.blend_id IS NOT NULL
          AND s.shortfall_units > 0
          AND NOT EXISTS (
            SELECT 1 FROM blend_components bc WHERE bc.blend_id = s.blend_id
          )
      ), '[]'::jsonb)
    )
  );
END;
$$;
