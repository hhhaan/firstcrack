CREATE OR REPLACE FUNCTION public.get_stock_summary_rows(
  p_user_id uuid,
  p_horizon_days integer DEFAULT 28,
  p_bean_id uuid DEFAULT NULL
)
RETURNS TABLE (
  bean_id uuid,
  current_grams integer,
  available_grams integer,
  reserved_grams integer,
  effective_grams integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid := p_user_id;
BEGIN
  IF v_owner_id IS NULL AND p_bean_id IS NOT NULL THEN
    SELECT b.user_id INTO v_owner_id
    FROM public.beans b
    WHERE b.id = p_bean_id;
  END IF;
  IF p_user_id IS NOT NULL AND NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  IF p_user_id IS NULL AND p_bean_id IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  RETURN QUERY
  WITH target_beans AS MATERIALIZED (
    SELECT b.id, b.user_id
    FROM public.beans b
    WHERE b.user_id = v_owner_id
      AND (p_bean_id IS NULL OR b.id = p_bean_id)
  ),
  ledger AS (
    SELECT e.bean_id, SUM(e.delta_grams)::integer AS grams
    FROM public.bean_stock_events e
    JOIN target_beans t ON t.id = e.bean_id
    WHERE e.user_id = v_owner_id
    GROUP BY e.bean_id
  ),
  materialized_candidates AS MATERIALIZED (
    SELECT b.*
    FROM public.roast_plan_batches b
    JOIN public.roast_day_plans p ON p.id = b.plan_id AND p.user_id = v_owner_id
    WHERE b.status IN ('pending', 'in-progress')
      AND b.exception_type IS DISTINCT FROM 'cancelled'
      AND (b.scheduled_date IS NULL OR b.scheduled_date <= CURRENT_DATE + p_horizon_days)
      AND (
        b.bean_id IN (SELECT id FROM target_beans)
        OR EXISTS (
          SELECT 1
          FROM public.blends bl
          JOIN public.blend_components bc ON bc.blend_id = bl.id
          JOIN target_beans t ON t.id = bc.bean_id
          WHERE bl.id = b.blend_id
            AND bl.user_id = v_owner_id
        )
      )
  ),
  completed_sessions AS (
    SELECT s.plan_batch_id, COUNT(*)::integer AS completed
    FROM public.roast_sessions s
    JOIN materialized_candidates b ON b.id = s.plan_batch_id
    GROUP BY s.plan_batch_id
  ),
  materialized_reservations AS (
    SELECT x.bean_id, SUM(x.grams)::integer AS grams
    FROM (
      SELECT
        b.bean_id,
        (
          GREATEST(
            0,
            public.calc_plan_batch_count(
              b.target_roasted_kg, b.batch_size_kg, b.yield_pct, b.batch_count
            ) - COALESCE(s.completed, 0)
          ) * b.batch_size_kg * 1000
        )::integer AS grams
      FROM materialized_candidates b
      JOIN target_beans t ON t.id = b.bean_id
      LEFT JOIN completed_sessions s ON s.plan_batch_id = b.id

      UNION ALL

      SELECT
        bc.bean_id,
        (
          GREATEST(
            0,
            public.calc_plan_batch_count(
              b.target_roasted_kg, b.batch_size_kg, b.yield_pct, b.batch_count
            ) - COALESCE(s.completed, 0)
          ) * b.batch_size_kg * 1000 * bc.ratio_pct / 100
        )::integer AS grams
      FROM materialized_candidates b
      JOIN public.blends bl ON bl.id = b.blend_id AND bl.user_id = v_owner_id
      JOIN public.blend_components bc ON bc.blend_id = bl.id
      JOIN target_beans t ON t.id = bc.bean_id
      LEFT JOIN completed_sessions s ON s.plan_batch_id = b.id
      WHERE b.blend_id IS NOT NULL
    ) x
    GROUP BY x.bean_id
  ),
  recurrence_candidates AS MATERIALIZED (
    SELECT
      r.id,
      r.bean_id,
      r.blend_id,
      r.rrule,
      r.dtstart,
      r."until",
      r.batch_size_kg,
      public.calc_plan_batch_count(
        r.target_roasted_kg, r.batch_size_kg, r.yield_pct, NULL
      ) AS batch_count
    FROM public.recurrence_rules r
    WHERE r.user_id = v_owner_id
      AND r.status = 'active'
      AND (r."until" IS NULL OR r."until" >= CURRENT_DATE)
      AND (
        r.bean_id IN (SELECT id FROM target_beans)
        OR EXISTS (
          SELECT 1
          FROM public.blends bl
          JOIN public.blend_components bc ON bc.blend_id = bl.id
          JOIN target_beans t ON t.id = bc.bean_id
          WHERE bl.id = r.blend_id
            AND bl.user_id = v_owner_id
        )
      )
  ),
  recurrence_occurrences AS MATERIALIZED (
    SELECT r.*, occurrence.day
    FROM recurrence_candidates r
    CROSS JOIN LATERAL public.expand_rrule_in_range(
      r.rrule,
      r.dtstart,
      CURRENT_DATE,
      CURRENT_DATE + p_horizon_days,
      r."until"
    ) occurrence(day)
    LEFT JOIN public.roast_plan_batches ex
      ON ex.recurrence_rule_id = r.id
     AND ex.original_date = occurrence.day
    WHERE ex.id IS NULL
  ),
  virtual_reservations AS (
    SELECT x.bean_id, SUM(x.grams)::integer AS grams
    FROM (
      SELECT
        r.bean_id,
        (r.batch_count * r.batch_size_kg * 1000)::integer AS grams
      FROM recurrence_occurrences r
      JOIN target_beans t ON t.id = r.bean_id

      UNION ALL

      SELECT
        bc.bean_id,
        (
          r.batch_count * r.batch_size_kg * 1000 * bc.ratio_pct / 100
        )::integer AS grams
      FROM recurrence_occurrences r
      JOIN public.blends bl ON bl.id = r.blend_id AND bl.user_id = v_owner_id
      JOIN public.blend_components bc ON bc.blend_id = bl.id
      JOIN target_beans t ON t.id = bc.bean_id
      WHERE r.blend_id IS NOT NULL
    ) x
    GROUP BY x.bean_id
  ),
  summary AS (
    SELECT
      t.id AS bean_id,
      COALESCE(l.grams, 0) AS current_grams,
      COALESCE(l.grams, 0) AS available_grams,
      COALESCE(m.grams, 0) + COALESCE(v.grams, 0) AS reserved_grams
    FROM target_beans t
    LEFT JOIN ledger l ON l.bean_id = t.id
    LEFT JOIN materialized_reservations m ON m.bean_id = t.id
    LEFT JOIN virtual_reservations v ON v.bean_id = t.id
  )
  SELECT
    s.bean_id,
    s.current_grams,
    s.available_grams,
    s.reserved_grams,
    s.available_grams - s.reserved_grams AS effective_grams
  FROM summary s;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bean_reserved_stock(
  p_bean_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE WHEN p_bean_id IS NULL THEN 0 ELSE COALESCE(
      (SELECT s.reserved_grams
       FROM public.get_stock_summary_rows(NULL, p_horizon_days, p_bean_id) s),
      0
    ) END;
$$;

CREATE OR REPLACE FUNCTION public.get_bean_effective_stock(
  p_bean_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE WHEN p_bean_id IS NULL THEN 0 ELSE COALESCE(
      (SELECT s.effective_grams
       FROM public.get_stock_summary_rows(NULL, p_horizon_days, p_bean_id) s),
      0
    ) END;
$$;

CREATE OR REPLACE FUNCTION public.get_bean_stock_summary(
  p_bean_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE WHEN p_bean_id IS NULL THEN jsonb_build_object(
    'current_grams', 0,
    'available_grams', 0,
    'reserved_grams', 0,
    'effective_grams', 0
  ) ELSE COALESCE(
    (SELECT jsonb_build_object(
      'current_grams', s.current_grams,
      'available_grams', s.available_grams,
      'reserved_grams', s.reserved_grams,
      'effective_grams', s.effective_grams
    )
    FROM public.get_stock_summary_rows(NULL, p_horizon_days, p_bean_id) s),
    jsonb_build_object(
      'current_grams', 0,
      'available_grams', 0,
      'reserved_grams', 0,
      'effective_grams', 0
    )
  ) END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_stock_summaries(
  p_user_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS jsonb
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
    SELECT COALESCE(
      jsonb_object_agg(
        s.bean_id::text,
        jsonb_build_object(
          'current_grams', s.current_grams,
          'available_grams', s.available_grams,
          'reserved_grams', s.reserved_grams,
          'effective_grams', s.effective_grams
        )
      ),
      '{}'::jsonb
    )
    FROM public.get_stock_summary_rows(p_user_id, p_horizon_days, NULL) s
  );
END;
$$;

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
      LEFT JOIN public.blend_components bc ON bc.blend_id = s.blend_id
      WHERE s.shortfall_units > 0
        AND (s.bean_id IS NOT NULL OR bc.bean_id IS NOT NULL)
      GROUP BY COALESCE(bc.bean_id, s.bean_id), s.roast_profile_id
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

CREATE OR REPLACE FUNCTION public.compute_inventory_alerts(
  p_user_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_computed_at timestamptz := now();
  v_changed integer;
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  WITH snapshot AS MATERIALIZED (
    SELECT s.*, b.low_stock_threshold_grams
    FROM public.get_stock_summary_rows(p_user_id, p_horizon_days, NULL) s
    JOIN public.beans b ON b.id = s.bean_id
  ),
  candidates AS MATERIALIZED (
    SELECT s.*, 'out'::text AS reason
    FROM snapshot s
    WHERE s.current_grams <= 0

    UNION ALL

    SELECT s.*, 'schedule'::text AS reason
    FROM snapshot s
    WHERE s.effective_grams < 0

    UNION ALL

    SELECT s.*, 'low'::text AS reason
    FROM snapshot s
    WHERE s.current_grams > 0
      AND s.current_grams <= s.low_stock_threshold_grams
  ),
  upserted AS (
    INSERT INTO public.inventory_alerts (
      user_id, bean_id, reason,
      current_grams, available_grams, reserved_grams, effective_grams,
      horizon_days, computed_at, dismissed_at
    )
    SELECT
      p_user_id, c.bean_id, c.reason,
      c.current_grams, c.available_grams, c.reserved_grams, c.effective_grams,
      p_horizon_days, v_computed_at, NULL
    FROM candidates c
    ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
      current_grams = EXCLUDED.current_grams,
      available_grams = EXCLUDED.available_grams,
      reserved_grams = EXCLUDED.reserved_grams,
      effective_grams = EXCLUDED.effective_grams,
      horizon_days = EXCLUDED.horizon_days,
      computed_at = EXCLUDED.computed_at,
      dismissed_at = NULL
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM public.inventory_alerts a
    WHERE a.user_id = p_user_id
      AND NOT EXISTS (
        SELECT 1
        FROM candidates c
        WHERE c.bean_id = a.bean_id
          AND c.reason = a.reason
      )
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM upserted) + (SELECT COUNT(*) FROM deleted)
  INTO v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.get_stock_summary_rows(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_stock_summary_rows(uuid, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_stock_summary_rows(uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_summary_rows(uuid, integer, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_bean_reserved_stock(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_bean_effective_stock(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_bean_stock_summary(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_stock_summaries(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_roasting_requirements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_inventory_alerts(uuid, integer) TO authenticated;
