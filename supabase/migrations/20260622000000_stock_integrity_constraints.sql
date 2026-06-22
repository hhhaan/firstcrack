-- Phase 0: Data integrity constraints for stock and blend ratios

-- ── blend_components: ratio sum must equal 100 per blend (deferrable) ────────

CREATE OR REPLACE FUNCTION check_blend_ratio_sum()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_blend_id uuid;
  v_total numeric;
BEGIN
  v_blend_id := COALESCE(NEW.blend_id, OLD.blend_id);

  SELECT COALESCE(SUM(ratio_pct), 0) INTO v_total
  FROM blend_components
  WHERE blend_id = v_blend_id;

  IF v_total <> 100 THEN
    RAISE EXCEPTION 'blend_components ratio_pct must sum to 100 (got %)', v_total;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER blend_components_ratio_sum
  AFTER INSERT OR UPDATE OR DELETE ON blend_components
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_blend_ratio_sum();

-- ── bean_stock_events: event_type-specific delta sign ───────────────────────

ALTER TABLE bean_stock_events
  DROP CONSTRAINT IF EXISTS bean_stock_events_delta_sign_check;

ALTER TABLE bean_stock_events
  ADD CONSTRAINT bean_stock_events_delta_sign_check
  CHECK (
    (event_type IN ('purchase', 'expected_inbound') AND delta_grams > 0)
    OR (event_type IN ('roast', 'write_off') AND delta_grams < 0)
    OR (event_type = 'adjustment')
  );
