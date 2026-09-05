-- #164 product ↔ channel key mapping table + #105 atomic manual order creation
--
-- product_channel_skus: one local product ↔ N external identifiers (platform variant id,
-- product id or merchant SKU). `products.sku` stays as the human-facing SKU and remains a
-- matching fallback so existing mappings keep resolving (see normalize.ts buildProductMap).
--
-- create_order: orders + order_lines in one transaction (SECURITY INVOKER, RLS applies —
-- same convention as fulfill_order / cancel_order in 20260801000003).

-- ── product_channel_skus ────────────────────────────────────────────────────

CREATE TABLE public.product_channel_skus (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('naver', 'cafe24', 'shopify')),
  external_key text NOT NULL CHECK (length(btrim(external_key)) > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_channel_skus_unique_key UNIQUE (user_id, platform, external_key)
);

CREATE INDEX product_channel_skus_product_idx ON public.product_channel_skus(product_id);

ALTER TABLE public.product_channel_skus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace access product_channel_skus" ON public.product_channel_skus
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_channel_skus TO authenticated;

-- ── create_order ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_order(p_order jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_order_id uuid;
  v_user_id  uuid;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'order_lines_required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) l
    WHERE coalesce((l->>'quantity')::integer, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'order_line_quantity_invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.orders (
    user_id, platform, platform_order_id, status, ordered_at, buyer_name, currency, total_amount
  )
  VALUES (
    (p_order->>'user_id')::uuid,
    coalesce(p_order->>'platform', 'manual'),
    coalesce(p_order->>'platform_order_id', gen_random_uuid()::text),
    coalesce(p_order->>'status', 'paid'),
    coalesce((p_order->>'ordered_at')::timestamptz, now()),
    p_order->>'buyer_name',
    p_order->>'currency',
    (p_order->>'total_amount')::numeric
  )
  RETURNING id, user_id INTO v_order_id, v_user_id;

  INSERT INTO public.order_lines (
    order_id, user_id, platform_line_id, product_id, title, quantity, unit_price
  )
  SELECT
    v_order_id,
    v_user_id,
    coalesce(l->>'platform_line_id', gen_random_uuid()::text),
    (l->>'product_id')::uuid,
    coalesce(l->>'title', ''),
    (l->>'quantity')::integer,
    (l->>'unit_price')::numeric
  FROM jsonb_array_elements(p_lines) l;

  RETURN v_order_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb) TO authenticated;
