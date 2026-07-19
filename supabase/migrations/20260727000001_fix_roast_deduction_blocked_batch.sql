-- C2 fix: batch complete remaining deduct was blocked when any session already deducted.
-- Only block batch-level ref when a batch-level roast event already exists.

CREATE OR REPLACE FUNCTION roast_deduction_blocked(p_reference_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_batch_id uuid;
BEGIN
  IF p_reference_id IS NULL THEN
    RETURN false;
  END IF;

  -- reference = plan_batch.id → only prior batch-level bulk deduct blocks retry
  IF EXISTS (SELECT 1 FROM roast_plan_batches WHERE id = p_reference_id) THEN
    RETURN EXISTS (
      SELECT 1 FROM bean_stock_events
      WHERE reference_id = p_reference_id AND event_type = 'roast'
      LIMIT 1
    );
  END IF;

  -- reference = roast_session.id → block if batch-level bulk deduct already recorded
  SELECT plan_batch_id INTO v_batch_id
  FROM roast_sessions
  WHERE id = p_reference_id;

  IF v_batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bean_stock_events
    WHERE reference_id = v_batch_id AND event_type = 'roast'
    LIMIT 1
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
