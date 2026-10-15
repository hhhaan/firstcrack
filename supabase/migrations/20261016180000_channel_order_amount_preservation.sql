-- #306 items 2 & 7, #872 — preserve channel order totals without redefining sync_channel_orders_batch.
-- (a) NULL total_amount from sync must not wipe an existing total (Cafe24 / Naver fallback).
-- (b) Naver partial line updates: recompute header total from ALL lines (incl. cancelled) = original order total.

CREATE OR REPLACE FUNCTION public.orders_keep_channel_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.platform <> 'manual'
    AND NEW.total_amount IS NULL
    AND OLD.total_amount IS NOT NULL
  THEN
    NEW.total_amount := OLD.total_amount;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_keep_channel_total() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.orders_keep_channel_total() FROM anon, authenticated;

DROP TRIGGER IF EXISTS orders_keep_channel_total ON public.orders;
CREATE TRIGGER orders_keep_channel_total
  BEFORE UPDATE OF total_amount ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_keep_channel_total();

CREATE OR REPLACE FUNCTION public.order_lines_recompute_naver_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_platform text;
  v_sum numeric;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT o.platform INTO v_platform FROM public.orders o WHERE o.id = v_order_id;
  IF v_platform IS DISTINCT FROM 'naver' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.order_lines ol
    WHERE ol.order_id = v_order_id AND ol.unit_price IS NOT NULL
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(ol.quantity * ol.unit_price), 0)
  INTO v_sum
  FROM public.order_lines ol
  WHERE ol.order_id = v_order_id;

  UPDATE public.orders o
  SET total_amount = v_sum, updated_at = now()
  WHERE o.id = v_order_id
    AND o.total_amount IS DISTINCT FROM v_sum;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.order_lines_recompute_naver_total() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.order_lines_recompute_naver_total() FROM anon, authenticated;

DROP TRIGGER IF EXISTS order_lines_recompute_naver_total ON public.order_lines;
CREATE TRIGGER order_lines_recompute_naver_total
  AFTER INSERT OR UPDATE OF quantity, unit_price, status ON public.order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.order_lines_recompute_naver_total();
