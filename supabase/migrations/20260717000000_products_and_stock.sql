-- Products (sellable SKU) + finished-goods stock ledger

-- ── products ────────────────────────────────────────────────────────────────

CREATE TABLE products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  sku              text,
  bean_id          uuid REFERENCES beans(id) ON DELETE SET NULL,
  blend_id         uuid REFERENCES blends(id) ON DELETE SET NULL,
  roast_profile_id uuid REFERENCES roast_profiles(id) ON DELETE SET NULL,
  net_weight_grams integer NOT NULL CHECK (net_weight_grams > 0),
  yield_pct        numeric NOT NULL DEFAULT 0.85 CHECK (yield_pct > 0 AND yield_pct <= 1),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- both null = non-coffee item (merch); never both set
  CONSTRAINT single_source CHECK (NOT (bean_id IS NOT NULL AND blend_id IS NOT NULL)),
  CONSTRAINT unique_sku_per_user UNIQUE (user_id, sku)
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own products" ON products
  FOR ALL USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON products TO authenticated;

-- ── product_stock_events (finished-goods ledger, unit = bags) ───────────────

CREATE TABLE product_stock_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta_units  integer NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN ('roast_inbound', 'order_fulfillment', 'order_cancel', 'adjustment', 'write_off')),
  reference_id uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sign_by_type CHECK (
    (event_type IN ('roast_inbound', 'order_cancel') AND delta_units > 0)
    OR (event_type IN ('order_fulfillment', 'write_off') AND delta_units < 0)
    OR (event_type = 'adjustment' AND delta_units <> 0)
  )
);

-- event_type in the key: a fulfillment deduction and its later cancel
-- compensation share reference_id (= order_line.id), each individually idempotent
CREATE UNIQUE INDEX product_stock_events_reference_unique
  ON product_stock_events(reference_id, product_id, event_type)
  WHERE reference_id IS NOT NULL;

ALTER TABLE product_stock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own product stock events" ON product_stock_events
  FOR ALL USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON product_stock_events TO authenticated;

-- ── RPCs ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION insert_product_stock_events_batch(p_events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'product_id')::uuid,
    (e->>'delta_units')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', '')
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION get_product_current_stock(p_product_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(SUM(delta_units), 0)::integer
  FROM product_stock_events
  WHERE product_id = p_product_id;
$$;

CREATE OR REPLACE FUNCTION get_user_product_stock(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    jsonb_object_agg(p.id::text, get_product_current_stock(p.id)),
    '{}'::jsonb
  )
  FROM products p
  WHERE p.user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION insert_product_stock_events_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION get_product_current_stock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_product_stock(uuid) TO authenticated;
