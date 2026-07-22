-- Perf indexes + set-based stock aggregation + atomic order fulfillment

-- Stock reads aggregate by product_id; the partial unique index
-- (reference_id, product_id, event_type) can't serve that lookup.
CREATE INDEX product_stock_events_product_idx ON product_stock_events(product_id);

-- Orders list: user_id filter + ordered_at DESC sort.
CREATE INDEX orders_user_ordered_idx ON orders(user_id, ordered_at DESC);

-- Roasting requirements filters order_lines by user_id.
CREATE INDEX order_lines_user_idx ON order_lines(user_id);

-- Set-based rewrite: was one correlated get_product_current_stock() call per product.
CREATE OR REPLACE FUNCTION get_user_product_stock(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_object_agg(p.id::text, COALESCE(s.units, 0)),
    '{}'::jsonb
  )
  FROM products p
  LEFT JOIN (
    SELECT product_id, SUM(delta_units)::integer AS units
    FROM product_stock_events
    GROUP BY product_id
  ) s ON s.product_id = p.id
  WHERE p.user_id = p_user_id;
$$;

-- Same rewrite here: stock joined once instead of two function calls per shortfall row.
CREATE OR REPLACE FUNCTION get_roasting_requirements(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
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
  -- explode blends into component beans by ratio; single-origin passes through
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
    ), '[]'::jsonb)
  );
$$;

-- Atomic fulfillment: deduct + stamp in one transaction (was two client round trips
-- with a half-fulfilled state possible between them). Idempotent via the partial
-- unique index; RLS (SECURITY INVOKER) scopes it to the caller's own order.
CREATE OR REPLACE FUNCTION fulfill_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id)
  SELECT ol.user_id, ol.product_id, -ol.quantity, 'order_fulfillment', ol.id
  FROM order_lines ol
  WHERE ol.order_id = p_order_id
    AND ol.status = 'active'
    AND ol.product_id IS NOT NULL
  ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING;

  UPDATE orders
  SET fulfilled_at = now(), updated_at = now()
  WHERE id = p_order_id AND fulfilled_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION fulfill_order(uuid) TO authenticated;
