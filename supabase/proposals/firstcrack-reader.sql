-- REVIEW PROPOSAL ONLY. Not a migration and never applied by release automation.
-- Requires approval, a full local Supabase reset/test and hosted configuration review.
-- Do not enable OAuth or FIRSTCRACK_MCP_ENABLED before every boundary is verified.

CREATE ROLE firstcrack_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT firstcrack_reader TO authenticator;
GRANT USAGE ON SCHEMA public, auth TO firstcrack_reader;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO firstcrack_reader;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(uuid),
    public.is_org_owner(uuid), public.is_org_member_or_owner(uuid) TO firstcrack_reader;

-- Preserve the existing native owner/member predicate while also restricting this
-- role's directly callable membership RPC to its approved connection workspace.
CREATE OR REPLACE FUNCTION public.has_workspace_access(target_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT (
        (auth.jwt() ->> 'role') IS DISTINCT FROM 'firstcrack_reader'
        OR target_owner = (auth.jwt() ->> 'firstcrack_workspace_owner_id')::uuid
    ) AND (
        auth.uid() = target_owner OR EXISTS (
            SELECT 1 FROM organizations o JOIN organization_members m ON m.org_id = o.id
            WHERE o.owner_id = target_owner AND m.user_id = auth.uid()
        )
    );
$$;

GRANT SELECT (id, display_name, business_name, country_code) ON public.profiles TO firstcrack_reader;
GRANT SELECT (id, owner_id, name) ON public.organizations TO firstcrack_reader;
GRANT SELECT (id, user_id, name, origin, region, variety, process, low_stock_threshold_grams)
    ON public.beans TO firstcrack_reader;
GRANT SELECT (id, user_id, name, sku, net_weight_grams, bean_id, blend_id, roast_profile_id, is_active)
    ON public.products TO firstcrack_reader;
GRANT SELECT (id, user_id, platform, status, ordered_at, fulfilled_at) ON public.orders TO firstcrack_reader;
GRANT SELECT (id, user_id, order_id, product_id, title, quantity, status) ON public.order_lines TO firstcrack_reader;
GRANT SELECT (id, user_id, date) ON public.roast_day_plans TO firstcrack_reader;
GRANT SELECT (id, plan_id, bean_name, batch_count, batch_size_kg, target_roasted_kg, status, scheduled_date)
    ON public.roast_plan_batches TO firstcrack_reader;
GRANT SELECT (id, user_id, batch_name, bean_label, status, roasted_at, weight_grams, output_weight_grams, duration_seconds)
    ON public.roast_sessions TO firstcrack_reader;

-- Existing permissive owner/member policies still apply. These restrictive policies
-- further limit this role to the workspace approved at connection time.
DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['beans', 'products', 'orders', 'order_lines', 'roast_day_plans', 'roast_sessions'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity) THEN
            RAISE EXCEPTION 'RLS must be enabled before granting integration access: %', table_name;
        END IF;
        EXECUTE format('CREATE POLICY firstcrack_reader_workspace ON public.%I AS RESTRICTIVE
            FOR SELECT TO firstcrack_reader USING (
                user_id = (auth.jwt() ->> ''firstcrack_workspace_owner_id'')::uuid
                AND public.has_workspace_access(user_id))', table_name);
    END LOOP;
END $$;

CREATE POLICY firstcrack_reader_self_profile ON public.profiles
    FOR SELECT TO firstcrack_reader USING (id = auth.uid());
CREATE POLICY firstcrack_reader_self_profile_scope ON public.profiles AS RESTRICTIVE
    FOR SELECT TO firstcrack_reader USING (id = auth.uid());
CREATE POLICY firstcrack_reader_org_scope ON public.organizations AS RESTRICTIVE
    FOR SELECT TO firstcrack_reader USING (
        owner_id = (auth.jwt() ->> 'firstcrack_workspace_owner_id')::uuid
        AND public.has_workspace_access(owner_id));
CREATE POLICY firstcrack_reader_batch_scope ON public.roast_plan_batches AS RESTRICTIVE
    FOR SELECT TO firstcrack_reader USING (
        EXISTS (SELECT 1 FROM public.roast_day_plans p WHERE p.id = plan_id
            AND p.user_id = (auth.jwt() ->> 'firstcrack_workspace_owner_id')::uuid));

-- PUBLIC EXECUTE on a SECURITY DEFINER RPC can otherwise bypass table grants.
-- A reviewed PostgREST pre-request hook must reject all unapproved RPCs and writes.
-- Compose this with any existing hosted hook; do not silently replace that hook.
CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION private.firstcrack_read_guard() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
    claims jsonb := auth.jwt();
    owner_id uuid;
    method text := current_setting('request.method', true);
    path text := current_setting('request.path', true);
BEGIN
    IF current_user <> 'firstcrack_reader' THEN RETURN; END IF;
    owner_id := (claims ->> 'firstcrack_workspace_owner_id')::uuid;
    IF claims ->> 'role' IS DISTINCT FROM 'firstcrack_reader'
       OR owner_id IS NULL
       OR claims ->> 'firstcrack_access' IS DISTINCT FROM 'read'
       OR NOT ('openid' = ANY(regexp_split_to_array(coalesce(claims ->> 'scope', ''), '\s+')))
       OR public.has_workspace_access(owner_id) IS DISTINCT FROM true THEN
        RAISE insufficient_privilege USING MESSAGE = 'Integration connection not authorized';
    END IF;
    IF method IS NULL OR path IS NULL
       OR (path LIKE '/rpc/%' AND path <> '/rpc/has_workspace_access')
       OR (method NOT IN ('GET', 'HEAD') AND NOT (method = 'POST' AND path = '/rpc/has_workspace_access')) THEN
        RAISE insufficient_privilege USING MESSAGE = 'Integration is read-only';
    END IF;
    PERFORM set_config('transaction_read_only', 'on', true);
END $$;
REVOKE ALL ON FUNCTION private.firstcrack_read_guard() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO firstcrack_reader, authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION private.firstcrack_read_guard() TO firstcrack_reader, authenticated, anon, service_role;

-- Verify these three tables as well as the loop above. Existing policies stay enabled.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'organizations', 'roast_plan_batches')
                 AND NOT c.relrowsecurity) THEN
        RAISE EXCEPTION 'RLS must be enabled for all integration tables';
    END IF;
END $$;

-- Approval-required hosted step, intentionally not executed by this proposal:
-- ALTER ROLE authenticator SET pgrst.db_pre_request = 'private.firstcrack_read_guard';
-- NOTIFY pgrst, 'reload config';
