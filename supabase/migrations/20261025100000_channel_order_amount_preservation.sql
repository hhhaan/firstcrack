-- #306 items 2 & 7, #872 — preserve channel order totals on webhook / NULL sync payloads.
-- Naver partial-line totals are handled in sync_channel_orders_batch (20261016190000_partial_line_cancel).

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

-- Drop legacy naver line trigger if a prior revision of this migration applied it.
DROP TRIGGER IF EXISTS order_lines_recompute_naver_total ON public.order_lines;
DROP FUNCTION IF EXISTS public.order_lines_recompute_naver_total();
