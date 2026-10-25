-- ISOLATED SCRATCH DATABASE ONLY: creates fixture tables and roles.
-- This is not a full Supabase migration replay or a hosted OAuth test.
\set ON_ERROR_STOP on
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'), ('33333333-3333-4333-8333-333333333333'), ('44444444-4444-4444-8444-444444444444');
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub')::uuid;
$$;

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
GRANT EXECUTE ON FUNCTION public.has_workspace_access(uuid), public.is_org_owner(uuid), public.is_org_member_or_owner(uuid) TO authenticated;
GRANT SELECT ON public.organizations, public.profiles TO authenticated;

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


-- A second user's data and a roastery they do not share with the first user.
INSERT INTO profiles(id, display_name) VALUES ('33333333-3333-4333-8333-333333333333', 'other owner');
INSERT INTO beans(id, user_id, name) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','other owner bean');
INSERT INTO roast_sessions(id,user_id,batch_name,weight_grams) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','owner A roast',2000),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','owner B roast',1000);
INSERT INTO products(id,user_id,name) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','selected product'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','outside-connection product');
INSERT INTO orders(id,user_id,raw) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','{"private-buyer":"private-contact"}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','{}');
INSERT INTO order_lines(id,user_id,order_id,title,quantity) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','selected line',2);
INSERT INTO roast_day_plans(id,user_id,date) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','2026-10-25'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','2026-10-25');
INSERT INTO roast_plan_batches(id,plan_id,bean_name,batch_count) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','selected batch',2);
\ir ../proposals/firstcrack-mcp-opaque-issuer.sql
CREATE ROLE mcp_issuer_test LOGIN INHERIT;
CREATE ROLE mcp_gateway_test LOGIN INHERIT;
GRANT firstcrack_mcp_issuer TO mcp_issuer_test;
GRANT firstcrack_mcp_gateway TO mcp_gateway_test;
INSERT INTO private.mcp_clients(id,name,issuer,resource,redirect_uris,enabled) VALUES
 ('fixture-client','Protocol fixture','https://identity.example/oauth/mcp','https://resource.example/mcp',ARRAY['https://host.example/callback'],true);
