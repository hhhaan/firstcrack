-- ISOLATED SCRATCH DATABASE ONLY: creates fixture tables and roles.
-- This is not a full Supabase migration replay or a hosted OAuth test.
\set ON_ERROR_STOP on
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt() ->> 'sub')::uuid; $$;

CREATE TABLE profiles (id uuid PRIMARY KEY, display_name text, business_name text, country_code text, polar_customer_id text);
CREATE TABLE organizations (id uuid PRIMARY KEY, owner_id uuid, name text);
CREATE TABLE organization_members (org_id uuid, user_id uuid);
CREATE TABLE beans (id uuid PRIMARY KEY, user_id uuid, name text, origin text, region text, variety text,
    process text, low_stock_threshold_grams integer);
CREATE TABLE products (id uuid PRIMARY KEY, user_id uuid, name text, sku text, net_weight_grams integer,
    bean_id uuid, blend_id uuid, roast_profile_id uuid, is_active boolean);
CREATE TABLE orders (id uuid PRIMARY KEY, user_id uuid, platform text, status text, ordered_at timestamptz,
    fulfilled_at timestamptz, raw jsonb);
CREATE TABLE order_lines (id uuid PRIMARY KEY, user_id uuid, order_id uuid REFERENCES orders,
    product_id uuid, title text, quantity integer, status text);
CREATE TABLE roast_day_plans (id uuid PRIMARY KEY, user_id uuid, date date);
CREATE TABLE roast_plan_batches (id uuid PRIMARY KEY, plan_id uuid REFERENCES roast_day_plans,
    bean_name text, batch_count integer, batch_size_kg numeric, target_roasted_kg numeric, status text, scheduled_date date);
CREATE TABLE roast_sessions (id uuid PRIMARY KEY, user_id uuid, batch_name text, bean_label text, status text,
    roasted_at timestamptz, weight_grams integer, output_weight_grams integer, duration_seconds integer);

-- Same owner/member predicate as 20260718044457_workspaces.sql.
CREATE FUNCTION public.has_workspace_access(target_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT auth.uid() = target_owner OR EXISTS (
        SELECT 1 FROM organizations o JOIN organization_members m ON m.org_id = o.id
        WHERE o.owner_id = target_owner AND m.user_id = auth.uid());
$$;
CREATE FUNCTION public.is_org_owner(p_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM organizations WHERE id = p_org_id AND owner_id = auth.uid());
$$;
CREATE FUNCTION public.is_org_member_or_owner(p_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.is_org_owner(p_org_id) OR EXISTS (
        SELECT 1 FROM organization_members WHERE org_id = p_org_id AND user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.has_workspace_access(uuid), public.is_org_owner(uuid), public.is_org_member_or_owner(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(uuid) TO authenticated;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_self ON profiles USING (id = auth.uid());
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_member ON organizations FOR SELECT USING (public.is_org_member_or_owner(id));
ALTER TABLE roast_plan_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY batch_owner ON roast_plan_batches USING (EXISTS (
    SELECT 1 FROM roast_day_plans p WHERE p.id = plan_id AND public.has_workspace_access(p.user_id)));
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['beans', 'products', 'orders', 'order_lines', 'roast_day_plans', 'roast_sessions'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY workspace_access ON public.%I USING (public.has_workspace_access(user_id))', table_name);
    END LOOP;
END $$;

INSERT INTO profiles(id, display_name, polar_customer_id) VALUES
    ('11111111-1111-4111-8111-111111111111', 'member', 'private-billing-fixture'),
    ('22222222-2222-4222-8222-222222222222', 'owner', 'private-owner-fixture');
INSERT INTO organizations VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'selected'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', 'other-membership');
INSERT INTO organization_members VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111');
INSERT INTO beans(id, user_id, name) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'selected'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', 'outside-connection');

-- Simulate a legacy PUBLIC SECURITY DEFINER write RPC. The gateway hook must reject it.
CREATE FUNCTION public.fixture_definer_write() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    UPDATE public.beans SET name = 'unexpected-write';
$$;

\ir ../proposals/firstcrack-reader.sql

SET request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"firstcrack_reader","scope":"openid","firstcrack_access":"read","firstcrack_workspace_owner_id":"22222222-2222-4222-8222-222222222222"}';
SET request.method = 'GET';
SET request.path = '/beans';
SET ROLE firstcrack_reader;
BEGIN;
SELECT private.firstcrack_read_guard();
DO $$ BEGIN
    IF (SELECT count(*) FROM beans) <> 1 OR (SELECT name FROM beans) <> 'selected' THEN
        RAISE EXCEPTION 'selected workspace isolation failed';
    END IF;
    IF (SELECT count(*) FROM profiles) <> 1 OR (SELECT display_name FROM profiles) <> 'member' THEN
        RAISE EXCEPTION 'personal profile isolation failed';
    END IF;
    IF (SELECT count(*) FROM organizations) <> 1 THEN RAISE EXCEPTION 'organization scope failed'; END IF;
    IF public.has_workspace_access('33333333-3333-4333-8333-333333333333') THEN
        RAISE EXCEPTION 'membership RPC escaped connection scope';
    END IF;
    BEGIN
        PERFORM polar_customer_id FROM profiles;
        RAISE EXCEPTION 'billing columns exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        UPDATE beans SET name = 'unexpected-write';
        RAISE EXCEPTION 'table write allowed';
    EXCEPTION WHEN insufficient_privilege OR read_only_sql_transaction THEN NULL; END;
    IF current_setting('transaction_read_only') <> 'on' THEN RAISE EXCEPTION 'read-only transaction missing'; END IF;
END $$;
COMMIT;

-- A permitted read RPC stays usable; arbitrary SECURITY DEFINER RPCs and table writes do not.
SET request.method = 'POST';
SET request.path = '/rpc/has_workspace_access';
BEGIN;
SELECT private.firstcrack_read_guard();
DO $$ BEGIN
    IF NOT public.has_workspace_access('22222222-2222-4222-8222-222222222222') THEN
        RAISE EXCEPTION 'allowed membership RPC blocked';
    END IF;
END $$;
COMMIT;
SET request.path = '/rpc/fixture_definer_write';
DO $$ BEGIN
    BEGIN
        PERFORM private.firstcrack_read_guard();
        RAISE EXCEPTION 'definer write RPC allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET request.path = '/beans';
DO $$ BEGIN
    BEGIN
        PERFORM private.firstcrack_read_guard();
        RAISE EXCEPTION 'POST table write allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;
SET request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
SET ROLE authenticated;
DO $$ BEGIN
    IF NOT public.has_workspace_access('22222222-2222-4222-8222-222222222222')
       OR NOT public.has_workspace_access('33333333-3333-4333-8333-333333333333') THEN
        RAISE EXCEPTION 'native membership behavior changed';
    END IF;
END $$;
RESET ROLE;
SET request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"firstcrack_reader","scope":"openid","firstcrack_access":"read","firstcrack_workspace_owner_id":"22222222-2222-4222-8222-222222222222"}';
DELETE FROM organization_members WHERE org_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET ROLE firstcrack_reader;
SET request.method = 'GET';
DO $$ BEGIN
    BEGIN
        PERFORM private.firstcrack_read_guard();
        RAISE EXCEPTION 'removed membership accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    IF (SELECT count(*) FROM beans) <> 0 THEN RAISE EXCEPTION 'removed membership still reads'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM beans WHERE name = 'unexpected-write') THEN RAISE EXCEPTION 'fixture changed'; END IF;
END $$;
SELECT 'firstcrack reader scratch boundary checks passed' AS result;
