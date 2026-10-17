-- Minimal schema for stock concurrency SQL tests (local Postgres 17, not full Supabase reset).
-- Never run against a real Supabase `db reset` database — it would replace auth helpers.
DO $guard$
BEGIN
  IF to_regprocedure('public.has_workspace_access(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'stock_concurrency_schema.sql is test-harness only; public.has_workspace_access already exists';
  END IF;
END
$guard$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users (id) VALUES ('11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'postgres');
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO authenticated, service_role;

DO $$ BEGIN
  CREATE ROLE authenticated LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE service_role LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.has_workspace_access(target_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() = target_owner OR auth.uid() IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS beans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS blends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS blend_components (
  blend_id uuid NOT NULL REFERENCES blends(id) ON DELETE CASCADE,
  bean_id uuid NOT NULL REFERENCES beans(id),
  ratio_pct numeric NOT NULL,
  PRIMARY KEY (blend_id, bean_id)
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  net_weight_grams integer NOT NULL CHECK (net_weight_grams > 0),
  bean_id uuid REFERENCES beans(id),
  blend_id uuid REFERENCES blends(id)
);

CREATE TABLE IF NOT EXISTS product_stock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta_units integer NOT NULL,
  event_type text NOT NULL,
  reference_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_stock_events_reference_unique
  ON product_stock_events(reference_id, product_id, event_type)
  WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS roasted_stock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bean_id uuid REFERENCES beans(id),
  blend_id uuid REFERENCES blends(id),
  delta_grams integer NOT NULL,
  event_type text NOT NULL,
  reference_id uuid,
  note text,
  is_estimate boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS roasted_packaging_ref_unique
  ON roasted_stock_events(reference_id) WHERE event_type = 'packaging';
CREATE UNIQUE INDEX IF NOT EXISTS roasted_inbound_ref_unique
  ON roasted_stock_events(reference_id) WHERE event_type = 'roast_inbound';

CREATE TABLE IF NOT EXISTS bean_stock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bean_id uuid NOT NULL REFERENCES beans(id) ON DELETE CASCADE,
  delta_grams integer NOT NULL,
  event_type text NOT NULL,
  reference_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bean_stock_events_ref_bean_unique
  ON bean_stock_events(reference_id, bean_id) WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid,
  platform text NOT NULL,
  platform_order_id text NOT NULL,
  status text NOT NULL,
  fulfilled_at timestamptz,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, platform_order_id)
);

CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform_line_id text NOT NULL,
  product_id uuid REFERENCES products(id),
  title text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'active',
  UNIQUE (order_id, platform_line_id)
);

CREATE TABLE IF NOT EXISTS order_fulfillment_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  connection_id uuid,
  reason text NOT NULL DEFAULT 'insufficient_product_stock',
  shortages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS order_fulfillment_holds_open_order_idx
  ON order_fulfillment_holds (order_id) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS roast_day_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS recurrence_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rrule text NOT NULL,
  dtstart date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  until date,
  bean_name text,
  batch_size_kg numeric,
  target_roasted_kg numeric
);

CREATE TABLE IF NOT EXISTS roast_plan_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES roast_day_plans(id) ON DELETE CASCADE,
  bean_id uuid REFERENCES beans(id),
  blend_id uuid REFERENCES blends(id),
  bean_name text NOT NULL DEFAULT 'batch',
  batch_size_kg numeric NOT NULL DEFAULT 1,
  target_roasted_kg numeric NOT NULL DEFAULT 1,
  yield_pct numeric NOT NULL DEFAULT 1,
  batch_count integer GENERATED ALWAYS AS (
    CASE
      WHEN batch_size_kg <= 0 OR target_roasted_kg <= 0 THEN 1
      ELSE ceil(target_roasted_kg / (batch_size_kg * greatest(coalesce(yield_pct, 1), 0.0001)))::integer
    END
  ) STORED,
  status text NOT NULL DEFAULT 'pending',
  recurrence_rule_id uuid REFERENCES recurrence_rules(id),
  original_date date,
  exception_type text,
  order_index integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roast_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weight_grams integer,
  output_weight_grams integer,
  status text NOT NULL DEFAULT 'completed',
  bean_id uuid REFERENCES beans(id),
  bean_label text,
  plan_batch_id uuid REFERENCES roast_plan_batches(id),
  roasted_at timestamptz,
  duration_seconds integer,
  drop_temp_celsius integer,
  roast_level text,
  scheduled_at timestamptz,
  notes text,
  ambient_temp_celsius numeric,
  ambient_humidity_pct numeric,
  profile_id uuid,
  tsv_path text,
  bbp_tsv_path text,
  bbp_seconds integer,
  charge_temp_celsius integer,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  machine_id text,
  machine_name text,
  machine_roaster_key text,
  machine_brand text,
  machine_protocol text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
