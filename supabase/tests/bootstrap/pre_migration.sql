-- Pre-migration public schema.
--
-- Tables below existed in the hosted project before supabase/migrations/ was
-- adopted (the first migration only enables RLS on them). They are NOT a
-- migration: production already has them, and `supabase db push` must never
-- apply this file.
--
-- scripts/run-db-contracts.sh copies this into a throwaway project as the
-- earliest migration, then applies supabase/migrations/*.sql on top.
-- Columns added by those migrations are omitted here. Shape is reconstructed
-- from src/shared/types/database.types.ts minus ADD COLUMN migrations.
-- ponytail: types don't record nullability/defaults exactly; defaults are the
-- ones the SQL tests and data-migrations actually touch. Tighten if a later
-- migration starts assuming a constraint this file doesn't create.
-- auth.sessions is created by the runner as supabase_admin (postgres cannot
-- write the auth schema). Two LANGUAGE sql helpers read it at create time.

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  avatar_url text,
  display_name text,
  plan text NOT NULL DEFAULT 'free',
  polar_customer_id text,
  default_roast_profile_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_plan_check CHECK (plan = ANY (ARRAY['free'::text, 'pro'::text, 'team'::text]))
);

CREATE TABLE public.beans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  origin text,
  region text,
  variety text,
  process text,
  farm text,
  vendor text,
  altitude_masl integer,
  tasting_notes text,
  purchase_date date,
  cost_per_kg numeric,
  capacity_grams integer NOT NULL DEFAULT 0,
  low_stock_threshold_grams integer NOT NULL DEFAULT 0,
  -- Dropped by 20260619000001 after the stock_grams → events backfill.
  stock_grams integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dropped by 20260619000001. The first migration enables RLS on it.
CREATE TABLE public.bean_inventory_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roast_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_level text NOT NULL,
  description text,
  charge_temp_celsius numeric,
  drop_temp_celsius numeric,
  duration_sec integer,
  dev_pct numeric,
  dev_time_sec integer,
  -- Nullable until 20260906000000 sets NOT NULL and replaces this FK.
  source_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roast_day_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE TABLE public.roast_plan_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.roast_day_plans(id) ON DELETE CASCADE,
  bean_id uuid REFERENCES public.beans(id) ON DELETE SET NULL,
  bean_name text NOT NULL DEFAULT '',
  roast_profile_id uuid REFERENCES public.roast_profiles(id) ON DELETE SET NULL,
  machine_id text,
  green_lot text NOT NULL DEFAULT '',
  batch_size_kg numeric NOT NULL DEFAULT 0,
  yield_pct numeric NOT NULL DEFAULT 0,
  target_roasted_kg numeric NOT NULL DEFAULT 0,
  batch_count integer NOT NULL DEFAULT 1,
  batch_type text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.roast_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  weight_grams integer NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  roasted_at timestamptz,
  -- Integer column. Fractional seconds arrive as jsonb text; save_roast_op rounds them (#619).
  duration_seconds integer,
  drop_temp_celsius integer,
  roast_level text,
  scheduled_at timestamptz,
  notes text,
  bean_id uuid REFERENCES public.beans(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.roast_profiles(id) ON DELETE SET NULL,
  tsv_path text,
  plan_batch_id uuid REFERENCES public.roast_plan_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.roast_profiles
  ADD CONSTRAINT roast_profiles_source_session_id_fkey
  FOREIGN KEY (source_session_id) REFERENCES public.roast_sessions(id) ON DELETE SET NULL;

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL,
  amount numeric,
  cancel_at_period_end boolean,
  canceled_at timestamptz,
  currency text,
  current_period_end timestamptz,
  current_period_start timestamptz,
  ends_at timestamptz,
  polar_checkout_id text,
  polar_product_id text,
  polar_subscription_id text,
  recurring_interval text,
  started_at timestamptz,
  trial_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Policies in 20260726000000 assume this table. It was never created by a migration.
CREATE TABLE public.machine_connection_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  duration_sec integer,
  error_message text,
  machine_id text,
  params jsonb,
  protocol text NOT NULL DEFAULT '',
  roaster_key text NOT NULL DEFAULT '',
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
