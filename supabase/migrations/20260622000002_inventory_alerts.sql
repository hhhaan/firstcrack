-- Phase 2: inventory_alerts table + compute function

CREATE TABLE inventory_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bean_id uuid NOT NULL REFERENCES beans(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('out', 'schedule', 'low')),
  current_grams integer NOT NULL,
  available_grams integer NOT NULL,
  reserved_grams integer NOT NULL,
  effective_grams integer NOT NULL,
  horizon_days integer NOT NULL DEFAULT 28,
  computed_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE (user_id, bean_id, reason)
);

ALTER TABLE inventory_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own inventory_alerts"
  ON inventory_alerts
  FOR ALL
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_alerts TO authenticated;

CREATE OR REPLACE FUNCTION compute_inventory_alerts(
  p_user_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_bean record;
  v_current integer;
  v_available integer;
  v_reserved integer;
  v_effective integer;
BEGIN
  FOR v_bean IN
    SELECT id, low_stock_threshold_grams
    FROM beans
    WHERE user_id = p_user_id
  LOOP
    v_current := get_bean_current_stock(v_bean.id);
    v_available := get_bean_available_stock(v_bean.id);
    v_reserved := get_bean_reserved_stock(v_bean.id, p_horizon_days);
    v_effective := v_available - v_reserved;

    -- Resolved: remove stale alerts
    IF v_current > 0 AND v_effective >= 0 AND v_current > v_bean.low_stock_threshold_grams THEN
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id;
      CONTINUE;
    END IF;

    IF v_current <= 0 THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'out',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    END IF;

    IF v_effective < 0 THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'schedule',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    ELSE
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id AND reason = 'schedule';
    END IF;

    IF v_current > 0 AND v_current <= v_bean.low_stock_threshold_grams THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'low',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    ELSE
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id AND reason = 'low';
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_inventory_alerts(uuid, integer) TO authenticated;
