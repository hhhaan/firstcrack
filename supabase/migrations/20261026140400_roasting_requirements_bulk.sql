-- #895: packable bulk is allocated once per bean or blend, in product id order.
-- Only grams the bulk cannot cover become a roasting requirement.
-- Finished-goods shortfall is unchanged.

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
      FROM public.order_lines ol
      JOIN public.orders o ON o.id = ol.order_id
      WHERE ol.user_id = p_user_id
        AND ol.status = 'active'
        AND ol.product_id IS NOT NULL
        AND o.status IN ('paid', 'preparing')
        AND o.fulfilled_at IS NULL
      GROUP BY ol.product_id
    ),
    stock AS (
      SELECT e.product_id, SUM(e.delta_units)::integer AS units
      FROM public.product_stock_events e
      GROUP BY e.product_id
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
      JOIN public.products p ON p.id = d.product_id
      LEFT JOIN stock st ON st.product_id = d.product_id
    ),
    bulk_demand AS (
      SELECT
        s.*,
        CASE
          WHEN s.blend_id IS NOT NULL THEN 'blend:' || s.blend_id::text
          ELSE 'bean:' || s.bean_id::text
        END AS bulk_key,
        (s.shortfall_units::numeric * s.net_weight_grams) AS demand_grams
      FROM shortfall s
      WHERE s.shortfall_units > 0
        AND (s.bean_id IS NOT NULL OR s.blend_id IS NOT NULL)
    ),
    bulk_pools AS (
      SELECT
        CASE
          WHEN e.blend_id IS NOT NULL THEN 'blend:' || e.blend_id::text
          ELSE 'bean:' || e.bean_id::text
        END AS bulk_key,
        SUM(e.delta_grams)::numeric AS grams
      FROM public.roasted_stock_events e
      WHERE e.bean_id IS NOT NULL OR e.blend_id IS NOT NULL
      GROUP BY 1
    ),
    bulk_queue AS (
      SELECT
        d.*,
        GREATEST(COALESCE(p.grams, 0), 0) AS pool,
        SUM(d.demand_grams) OVER (
          PARTITION BY d.bulk_key
          ORDER BY d.product_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cum_demand
      FROM bulk_demand d
      LEFT JOIN bulk_pools p ON p.bulk_key = d.bulk_key
    ),
    allocated AS (
      SELECT
        q.*,
        GREATEST(
          0,
          LEAST(q.demand_grams, q.pool - (q.cum_demand - q.demand_grams))
        ) AS taken_grams
      FROM bulk_queue q
    ),
    bean_demand AS (
      SELECT
        COALESCE(bc.bean_id, a.bean_id) AS bean_id,
        a.roast_profile_id,
        SUM(
          (a.demand_grams - a.taken_grams)
          * COALESCE(bc.ratio_pct, 100) / 100
        ) AS roasted_grams,
        SUM(
          (a.demand_grams - a.taken_grams)
          * COALESCE(bc.ratio_pct, 100) / 100
          / a.yield_pct
        ) AS green_grams
      FROM allocated a
      LEFT JOIN public.blend_components bc ON bc.blend_id = a.blend_id
      WHERE a.bean_id IS NOT NULL OR bc.bean_id IS NOT NULL
      GROUP BY COALESCE(bc.bean_id, a.bean_id), a.roast_profile_id
    ),
    green_stock AS (
      SELECT e.bean_id, SUM(e.delta_grams)::integer AS grams
      FROM public.bean_stock_events e
      JOIN (SELECT DISTINCT bd.bean_id FROM bean_demand bd) d ON d.bean_id = e.bean_id
      GROUP BY e.bean_id
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
          'green_available', COALESCE(gs.grams, 0)
        ))
        FROM bean_demand bd
        LEFT JOIN green_stock gs ON gs.bean_id = bd.bean_id
      ), '[]'::jsonb)
    )
  );
END;
$$;

