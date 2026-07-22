-- Toss Place POS (`toss_place`) as sales-channel + orders platform.
-- Cross-workspace unique merchant claim: one merchantId may bind to only one connection.

-- ── sales_channel_connections.platform ──────────────────────────────────────
ALTER TABLE sales_channel_connections
  DROP CONSTRAINT IF EXISTS sales_channel_connections_platform_check;

ALTER TABLE sales_channel_connections
  ADD CONSTRAINT sales_channel_connections_platform_check
  CHECK (platform IN ('naver', 'cafe24', 'shopify', 'toss_place'));

-- Global unique merchantId for toss_place (anti-hijack; see docs/agent/toss-place-integration.md §3.4)
CREATE UNIQUE INDEX IF NOT EXISTS sales_channel_connections_toss_place_merchant_uidx
  ON sales_channel_connections (platform, shop_identifier)
  WHERE platform = 'toss_place';

-- ── orders.platform ─────────────────────────────────────────────────────────
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_platform_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_platform_check
  CHECK (platform IN ('manual', 'naver', 'cafe24', 'shopify', 'toss_place'));
