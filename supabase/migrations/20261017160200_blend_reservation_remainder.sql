-- Blend reservation uses the same split as buildBlendDeductions:
-- round the charge, give each component round(charge * ratio), and give the
-- remainder to the last bean_id. Single-origin reservation is unchanged.
-- The split runs over every component, then target beans are filtered, so a
-- one-bean summary still sees that bean's share.

CREATE OR REPLACE FUNCTION public.allocate_blend_grams(
  p_blend_id uuid,
  p_charge_grams integer
)
RETURNS TABLE (bean_id uuid, grams integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH comps AS (
    SELECT
      bc.bean_id,
      bc.ratio_pct,
      row_number() OVER (ORDER BY bc.bean_id) AS n,
      count(*) OVER () AS cnt
    FROM public.blend_components bc
    WHERE bc.blend_id = p_blend_id
  ),
  shares AS (
    SELECT
      c.bean_id,
      c.n,
      c.cnt,
      CASE
        WHEN c.n = c.cnt THEN NULL
        ELSE round(p_charge_grams * c.ratio_pct / 100)::integer
      END AS rounded
    FROM comps c
  ),
  used AS (
    SELECT COALESCE(SUM(rounded), 0)::integer AS grams
    FROM shares
    WHERE rounded IS NOT NULL
  )
  SELECT
    s.bean_id,
    CASE
      WHEN s.n = s.cnt THEN p_charge_grams - u.grams
      ELSE s.rounded
    END AS grams
  FROM shares s
  CROSS JOIN used u
  ORDER BY s.bean_id;
$$;

REVOKE ALL ON FUNCTION public.allocate_blend_grams(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_blend_grams(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_blend_grams(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_blend_grams(uuid, integer) TO service_role;

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
        alloc.bean_id,
        alloc.grams
      FROM materialized_candidates b
      JOIN public.blends bl ON bl.id = b.blend_id AND bl.user_id = v_owner_id
      LEFT JOIN completed_sessions s ON s.plan_batch_id = b.id
      CROSS JOIN LATERAL public.allocate_blend_grams(
        bl.id,
        round(
          GREATEST(
            0,
            public.calc_plan_batch_count(
              b.target_roasted_kg, b.batch_size_kg, b.yield_pct, b.batch_count
            ) - COALESCE(s.completed, 0)
          ) * b.batch_size_kg * 1000
        )::integer
      ) alloc
      JOIN target_beans t ON t.id = alloc.bean_id
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
        alloc.bean_id,
        alloc.grams
      FROM recurrence_occurrences r
      JOIN public.blends bl ON bl.id = r.blend_id AND bl.user_id = v_owner_id
      CROSS JOIN LATERAL public.allocate_blend_grams(
        bl.id,
        round(r.batch_count * r.batch_size_kg * 1000)::integer
      ) alloc
      JOIN target_beans t ON t.id = alloc.bean_id
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


REVOKE ALL ON FUNCTION public.get_stock_summary_rows(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_stock_summary_rows(uuid, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_stock_summary_rows(uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_summary_rows(uuid, integer, uuid) TO service_role;
