-- Isolated schema boundary for the real plan/write-gate migrations; no customer data.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
-- Isolated token-verification boundary for testing the real MCP dispatcher's plan
-- check. This fixture is never installed in an application database.
CREATE FUNCTION private.mcp_access(token_hash text, expected_issuer text, expected_resource text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('scope','firstcrack:read firstcrack:write','sub',token_hash,
    'firstcrack_workspace_owner_id',token_hash);
$$;
CREATE TABLE private.mcp_write_requests (
  workspace_owner_id uuid, request_id uuid, production_id uuid, tool text,
  arguments jsonb, result jsonb, actor_id uuid, client_id text, created_at timestamptz
);
CREATE TABLE public.products(id uuid PRIMARY KEY, user_id uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '');
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE TABLE profiles (
  id uuid PRIMARY KEY, plan text NOT NULL DEFAULT 'trial', created_at timestamptz NOT NULL DEFAULT now(),
  polar_customer_id text, business_name text, simulator_enabled boolean NOT NULL DEFAULT false,
  CONSTRAINT profiles_plan_check CHECK (plan IN ('trial','tester','pro','pro_plus','enterprise','team','free','read_only'))
);
CREATE TABLE workspace_members (owner_id uuid, member_id uuid);
CREATE FUNCTION public.has_workspace_access(owner_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_members WHERE owner_id = $1 AND member_id = auth.uid());
$$;
CREATE TABLE roast_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'completed', roasted_at timestamptz DEFAULT now(),
  weight_grams integer DEFAULT 1000 CHECK (weight_grams >= 0), notes text,
  tsv_path text, bbp_tsv_path text, updated_at timestamptz DEFAULT now(), plan_batch_id uuid
);
CREATE TABLE bean_stock_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, reference_id uuid, delta_grams int);
CREATE TABLE roasted_stock_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE product_stock_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE roast_day_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE beans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE blends (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE roast_plan_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid REFERENCES roast_day_plans,
  status text DEFAULT 'pending', batch_count int DEFAULT 1, exception_type text, updated_at timestamptz DEFAULT now()
);
CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid, name text, seat_limit int);
CREATE TABLE organization_members (org_id uuid, user_id uuid, role text);
CREATE TABLE organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, token text, expires_at timestamptz,
  accepted_at timestamptz, revoked_at timestamptz
);
CREATE TABLE subscriptions(id uuid DEFAULT gen_random_uuid(), user_id uuid, polar_subscription_id text UNIQUE,
  status text CHECK(status IN ('active','trialing','incomplete','incomplete_expired','past_due','canceled','unpaid')),
  trial_end timestamptz, current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean, canceled_at timestamptz, ends_at timestamptz, polar_product_id text,
  amount integer, currency text, recurring_interval text, updated_at timestamptz);
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON profiles TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['roast_sessions','bean_stock_events','roasted_stock_events','product_stock_events','roast_day_plans','beans','blends'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY workspace_rows ON %I TO authenticated USING (public.has_workspace_access(user_id)) WITH CHECK (public.has_workspace_access(user_id))', t);
  END LOOP;
END $$;
