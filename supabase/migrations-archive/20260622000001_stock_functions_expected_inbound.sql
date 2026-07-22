-- Phase 1: expected_inbound event_type + stock calculation functions

-- ── event_type: add expected_inbound ────────────────────────────────────────

ALTER TABLE bean_stock_events
  DROP CONSTRAINT IF EXISTS bean_stock_events_event_type_check;

ALTER TABLE bean_stock_events
  ADD CONSTRAINT bean_stock_events_event_type_check
  CHECK (event_type IN ('purchase', 'roast', 'adjustment', 'write_off', 'expected_inbound'));

-- ── Helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION calc_plan_batch_count(
  p_target_roasted_kg numeric,
  p_batch_size_kg numeric,
  p_yield_pct numeric,
  p_batch_count integer DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_roasted_per_batch numeric;
BEGIN
  IF p_batch_count IS NOT NULL AND p_batch_count > 0 THEN
    RETURN p_batch_count;
  END IF;

  IF COALESCE(p_batch_size_kg, 0) <= 0 OR COALESCE(p_target_roasted_kg, 0) <= 0 THEN
    RETURN 1;
  END IF;

  v_roasted_per_batch := p_batch_size_kg * GREATEST(COALESCE(p_yield_pct, 1), 0.0001);
  RETURN CEIL(p_target_roasted_kg / v_roasted_per_batch)::integer;
END;
$$;

CREATE OR REPLACE FUNCTION expand_rrule_in_range(
  p_rrule text,
  p_dtstart date,
  p_range_start date,
  p_range_end date,
  p_until date DEFAULT NULL
) RETURNS SETOF date
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_effective_start date;
  v_effective_end date;
  v_current date;
  v_interval_weeks integer := 1;
BEGIN
  v_effective_start := GREATEST(p_dtstart, p_range_start);
  v_effective_end := LEAST(p_range_end, COALESCE(p_until, p_range_end));

  IF v_effective_start > v_effective_end THEN
    RETURN;
  END IF;

  IF p_rrule LIKE '%INTERVAL=2%' THEN
    v_interval_weeks := 2;
  END IF;

  IF p_rrule LIKE '%FREQ=DAILY%' THEN
    v_current := p_dtstart;
    WHILE v_current < v_effective_start LOOP
      v_current := v_current + 1;
    END LOOP;
    WHILE v_current <= v_effective_end LOOP
      RETURN NEXT v_current;
      v_current := v_current + 1;
    END LOOP;
    RETURN;
  END IF;

  IF p_rrule LIKE '%FREQ=WEEKLY%' THEN
    v_current := p_dtstart;
    WHILE v_current < v_effective_start LOOP
      v_current := v_current + (7 * v_interval_weeks);
    END LOOP;
    WHILE v_current <= v_effective_end LOOP
      RETURN NEXT v_current;
      v_current := v_current + (7 * v_interval_weeks);
    END LOOP;
    RETURN;
  END IF;

  IF p_rrule LIKE '%FREQ=MONTHLY%' THEN
    v_current := p_dtstart;
    WHILE v_current < v_effective_start LOOP
      v_current := (v_current + INTERVAL '1 month')::date;
    END LOOP;
    WHILE v_current <= v_effective_end LOOP
      RETURN NEXT v_current;
      v_current := (v_current + INTERVAL '1 month')::date;
    END LOOP;
    RETURN;
  END IF;

  RETURN;
END;
$$;

-- ── Current vs available stock ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_bean_current_stock(p_bean_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(SUM(delta_grams), 0)::integer
  FROM bean_stock_events
  WHERE bean_id = p_bean_id
    AND event_type <> 'expected_inbound';
$$;

CREATE OR REPLACE FUNCTION get_bean_available_stock(p_bean_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(SUM(delta_grams), 0)::integer
  FROM bean_stock_events
  WHERE bean_id = p_bean_id;
$$;

-- ── Reserved stock (SO + blend + virtual RRULE) ─────────────────────────────

CREATE OR REPLACE FUNCTION get_bean_reserved_stock(
  p_bean_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_horizon date := CURRENT_DATE + p_horizon_days;
  v_reserved integer := 0;
  v_row record;
  v_rec record;
  v_remaining integer;
  v_batch_count integer;
  v_occurrence date;
  v_excluded boolean;
BEGIN
  -- Materialized single-origin batches
  FOR v_row IN
    SELECT
      b.id,
      b.batch_size_kg,
      b.batch_count,
      b.yield_pct,
      b.target_roasted_kg,
      COALESCE(sess.completed, 0) AS completed
    FROM roast_plan_batches b
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS completed
      FROM roast_sessions s
      WHERE s.plan_batch_id = b.id
    ) sess ON true
    WHERE b.bean_id = p_bean_id
      AND b.status IN ('pending', 'in-progress')
      AND b.exception_type IS DISTINCT FROM 'cancelled'
      AND (b.scheduled_date IS NULL OR b.scheduled_date <= v_horizon)
  LOOP
    v_batch_count := calc_plan_batch_count(
      v_row.target_roasted_kg,
      v_row.batch_size_kg,
      v_row.yield_pct,
      v_row.batch_count
    );
    v_remaining := GREATEST(0, v_batch_count - v_row.completed);
    v_reserved := v_reserved + (v_remaining * v_row.batch_size_kg * 1000)::integer;
  END LOOP;

  -- Materialized blend batches (ratio-weighted)
  FOR v_row IN
    SELECT
      b.id,
      b.batch_size_kg,
      b.batch_count,
      b.yield_pct,
      b.target_roasted_kg,
      bc.ratio_pct,
      COALESCE(sess.completed, 0) AS completed
    FROM roast_plan_batches b
    JOIN blend_components bc ON bc.blend_id = b.blend_id AND bc.bean_id = p_bean_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS completed
      FROM roast_sessions s
      WHERE s.plan_batch_id = b.id
    ) sess ON true
    WHERE b.blend_id IS NOT NULL
      AND b.status IN ('pending', 'in-progress')
      AND b.exception_type IS DISTINCT FROM 'cancelled'
      AND (b.scheduled_date IS NULL OR b.scheduled_date <= v_horizon)
  LOOP
    v_batch_count := calc_plan_batch_count(
      v_row.target_roasted_kg,
      v_row.batch_size_kg,
      v_row.yield_pct,
      v_row.batch_count
    );
    v_remaining := GREATEST(0, v_batch_count - v_row.completed);
    v_reserved := v_reserved + (
      v_remaining * v_row.batch_size_kg * 1000 * v_row.ratio_pct / 100
    )::integer;
  END LOOP;

  -- Virtual SO recurrence rules
  FOR v_rec IN
    SELECT r.*
    FROM recurrence_rules r
    WHERE r.status = 'active'
      AND r.bean_id = p_bean_id
      AND (r.until IS NULL OR r.until >= v_today)
  LOOP
    v_batch_count := calc_plan_batch_count(
      v_rec.target_roasted_kg,
      v_rec.batch_size_kg,
      v_rec.yield_pct,
      NULL
    );

    FOR v_occurrence IN
      SELECT expand_rrule_in_range(
        v_rec.rrule,
        v_rec.dtstart,
        v_today,
        v_horizon,
        v_rec.until
      )
    LOOP
      SELECT EXISTS (
        SELECT 1
        FROM roast_plan_batches ex
        WHERE ex.recurrence_rule_id = v_rec.id
          AND ex.original_date = v_occurrence
      ) INTO v_excluded;

      IF NOT v_excluded THEN
        v_reserved := v_reserved + (v_batch_count * v_rec.batch_size_kg * 1000)::integer;
      END IF;
    END LOOP;
  END LOOP;

  -- Virtual blend recurrence rules
  FOR v_rec IN
    SELECT r.*, bc.ratio_pct
    FROM recurrence_rules r
    JOIN blend_components bc ON bc.blend_id = r.blend_id AND bc.bean_id = p_bean_id
    WHERE r.status = 'active'
      AND r.blend_id IS NOT NULL
      AND (r.until IS NULL OR r.until >= v_today)
  LOOP
    v_batch_count := calc_plan_batch_count(
      v_rec.target_roasted_kg,
      v_rec.batch_size_kg,
      v_rec.yield_pct,
      NULL
    );

    FOR v_occurrence IN
      SELECT expand_rrule_in_range(
        v_rec.rrule,
        v_rec.dtstart,
        v_today,
        v_horizon,
        v_rec.until
      )
    LOOP
      SELECT EXISTS (
        SELECT 1
        FROM roast_plan_batches ex
        WHERE ex.recurrence_rule_id = v_rec.id
          AND ex.original_date = v_occurrence
      ) INTO v_excluded;

      IF NOT v_excluded THEN
        v_reserved := v_reserved + (
          v_batch_count * v_rec.batch_size_kg * 1000 * v_rec.ratio_pct / 100
        )::integer;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_reserved;
END;
$$;

CREATE OR REPLACE FUNCTION get_bean_effective_stock(
  p_bean_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT get_bean_available_stock(p_bean_id) - get_bean_reserved_stock(p_bean_id, p_horizon_days);
$$;

CREATE OR REPLACE FUNCTION get_bean_stock_summary(
  p_bean_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'current_grams', get_bean_current_stock(p_bean_id),
    'available_grams', get_bean_available_stock(p_bean_id),
    'reserved_grams', get_bean_reserved_stock(p_bean_id, p_horizon_days),
    'effective_grams', get_bean_effective_stock(p_bean_id, p_horizon_days)
  );
$$;

CREATE OR REPLACE FUNCTION get_user_stock_summaries(
  p_user_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      b.id::text,
      get_bean_stock_summary(b.id, p_horizon_days)
    ),
    '{}'::jsonb
  )
  FROM beans b
  WHERE b.user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION get_bean_current_stock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bean_available_stock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bean_reserved_stock(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bean_effective_stock(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bean_stock_summary(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_stock_summaries(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION calc_plan_batch_count(numeric, numeric, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION expand_rrule_in_range(text, date, date, date, date) TO authenticated;
