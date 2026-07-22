-- Unique partial index: one roast event per (session, bean)
-- Prevents double-deduction on retry without touching purchase events (reference_id IS NULL)
CREATE UNIQUE INDEX bean_stock_events_reference_bean_unique
  ON bean_stock_events(reference_id, bean_id)
  WHERE reference_id IS NOT NULL;

-- Add write_off event type
ALTER TABLE bean_stock_events
  DROP CONSTRAINT IF EXISTS bean_stock_events_event_type_check;

ALTER TABLE bean_stock_events
  ADD CONSTRAINT bean_stock_events_event_type_check
  CHECK (event_type IN ('purchase', 'roast', 'adjustment', 'write_off'));

-- Atomic batch insert for blend deductions
-- SECURITY INVOKER: runs as the calling user, RLS is enforced
CREATE OR REPLACE FUNCTION insert_stock_events_batch(p_events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO bean_stock_events (user_id, bean_id, delta_grams, event_type, reference_id, note)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'bean_id')::uuid,
    (e->>'delta_grams')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', '')
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_stock_events_batch(jsonb) TO authenticated;
