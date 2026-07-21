-- Deprecate green pipeline stock: remove expected_inbound.
-- One-time DELETE is an intentional append-only exception (half-built feature; no complete/cancel path).
-- Physical inbound is purchase only (create + restock).

-- ── 1. Remove pipeline rows so available no longer diverges from current ────
DELETE FROM bean_stock_events
WHERE event_type = 'expected_inbound';

-- ── 2. Tighten event_type + delta sign checks ───────────────────────────────
ALTER TABLE bean_stock_events
  DROP CONSTRAINT IF EXISTS bean_stock_events_event_type_check;

ALTER TABLE bean_stock_events
  ADD CONSTRAINT bean_stock_events_event_type_check
  CHECK (event_type IN ('purchase', 'roast', 'adjustment', 'write_off'));

ALTER TABLE bean_stock_events
  DROP CONSTRAINT IF EXISTS bean_stock_events_delta_sign_check;

ALTER TABLE bean_stock_events
  ADD CONSTRAINT bean_stock_events_delta_sign_check
  CHECK (
    (event_type = 'purchase' AND delta_grams > 0)
    OR (event_type IN ('roast', 'write_off') AND delta_grams < 0)
    OR (event_type = 'adjustment')
  );

-- ── 3. current stock = sum of all events (same as available after cleanup) ──
CREATE OR REPLACE FUNCTION get_bean_current_stock(p_bean_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(SUM(delta_grams), 0)::integer
  FROM bean_stock_events
  WHERE bean_id = p_bean_id;
$$;
