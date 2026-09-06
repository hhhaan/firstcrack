-- #84 [ORD3] Toss Place POS: widen platform CHECKs + unique merchantId across workspaces.
-- CHECK-only + index; generated TS types already use `platform: string`.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_platform_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_platform_check
  CHECK (platform IN ('manual', 'naver', 'cafe24', 'shopify', 'toss_place'));

ALTER TABLE public.sales_channel_connections
  DROP CONSTRAINT IF EXISTS sales_channel_connections_platform_check;

ALTER TABLE public.sales_channel_connections
  ADD CONSTRAINT sales_channel_connections_platform_check
  CHECK (platform IN ('naver', 'cafe24', 'shopify', 'toss_place'));

ALTER TABLE public.product_channel_skus
  DROP CONSTRAINT IF EXISTS product_channel_skus_platform_check;

ALTER TABLE public.product_channel_skus
  ADD CONSTRAINT product_channel_skus_platform_check
  CHECK (platform IN ('naver', 'cafe24', 'shopify', 'toss_place'));

-- App keys are product-wide, so merchantId must be claimable by at most one workspace.
CREATE UNIQUE INDEX IF NOT EXISTS sales_channel_connections_toss_place_merchant_uidx
  ON public.sales_channel_connections (shop_identifier)
  WHERE platform = 'toss_place';
