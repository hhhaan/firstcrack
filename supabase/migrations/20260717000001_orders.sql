-- Orders + order lines (normalized cross-platform) + roasting requirements RPC

-- ── orders ──────────────────────────────────────────────────────────────────

CREATE TABLE orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id     uuid,  -- FK added with sales_channel_connections (Phase 2); null = manual
  platform          text NOT NULL CHECK (platform IN ('manual', 'naver', 'cafe24', 'shopify')),
  platform_order_id text NOT NULL,
  status            text NOT NULL CHECK (status IN ('pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded')),
  -- local pipeline state ("finished goods deducted"), deliberately separate from platform status
  fulfilled_at      timestamptz,
  ordered_at        timestamptz NOT NULL,
  buyer_name        text,
  currency          text,
  total_amount      numeric,
  raw               jsonb,
  synced_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_platform_order UNIQUE (user_id, platform, platform_order_id)
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own orders" ON orders
  FOR ALL USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO authenticated;

-- ── order_lines ─────────────────────────────────────────────────────────────

CREATE TABLE order_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform_line_id    text NOT NULL,
  product_id          uuid REFERENCES products(id) ON DELETE SET NULL,  -- null = unmapped
  platform_product_id text,
  platform_variant_id text,
  title               text NOT NULL,
  quantity            integer NOT NULL CHECK (quantity > 0),
  unit_price          numeric,
  -- line-level status: Naver's unit of change is the product-order, partial cancels are common
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'refunded')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_line_per_order UNIQUE (order_id, platform_line_id)
);

CREATE INDEX order_lines_product_idx ON order_lines(product_id) WHERE product_id IS NOT NULL;

ALTER TABLE order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own order lines" ON order_lines
  FOR ALL USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON order_lines TO authenticated;

-- ── Roasting requirements (display only, never writes) ─────────────────────

CREATE OR REPLACE FUNCTION get_roasting_requirements(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH demand AS (
    SELECT ol.product_id, SUM(ol.quantity)::integer AS ordered_units
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    WHERE ol.user_id = p_user_id
      AND ol.status = 'active'
      AND ol.product_id IS NOT NULL
      AND o.status IN ('paid', 'preparing')
      AND o.fulfilled_at IS NULL
    GROUP BY ol.product_id
  ),
  shortfall AS (
    SELECT
      d.product_id,
      d.ordered_units,
      get_product_current_stock(d.product_id) AS on_hand_units,
      GREATEST(0, d.ordered_units - get_product_current_stock(d.product_id)) AS shortfall_units,
      p.name,
      p.bean_id,
      p.blend_id,
      p.roast_profile_id,
      p.net_weight_grams,
      p.yield_pct
    FROM demand d
    JOIN products p ON p.id = d.product_id
  ),
  -- explode blends into component beans by ratio; single-origin passes through
  bean_demand AS (
    SELECT
      COALESCE(bc.bean_id, s.bean_id) AS bean_id,
      s.roast_profile_id,
      SUM(
        s.shortfall_units * s.net_weight_grams
        * COALESCE(bc.ratio_pct, 100) / 100
      ) AS roasted_grams,
      SUM(
        s.shortfall_units * s.net_weight_grams
        * COALESCE(bc.ratio_pct, 100) / 100 / s.yield_pct
      ) AS green_grams
    FROM shortfall s
    LEFT JOIN blend_components bc ON bc.blend_id = s.blend_id
    WHERE s.shortfall_units > 0
      AND (s.bean_id IS NOT NULL OR bc.bean_id IS NOT NULL)
    GROUP BY COALESCE(bc.bean_id, s.bean_id), s.roast_profile_id
  )
  SELECT jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', s.product_id,
        'name', s.name,
        'ordered_units', s.ordered_units,
        'on_hand_units', s.on_hand_units,
        'shortfall_units', s.shortfall_units
      ) ORDER BY s.name)
      FROM shortfall s
    ), '[]'::jsonb),
    'beans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bean_id', bd.bean_id,
        'roast_profile_id', bd.roast_profile_id,
        'roasted_grams_needed', ROUND(bd.roasted_grams)::integer,
        'green_grams_needed', ROUND(bd.green_grams)::integer,
        'green_available', get_bean_available_stock(bd.bean_id)
      ))
      FROM bean_demand bd
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION get_roasting_requirements(uuid) TO authenticated;
