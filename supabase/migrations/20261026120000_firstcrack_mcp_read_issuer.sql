-- Read-only MCP issuer. No stock, order, or Auth writes. No native token export.
-- skip-grant-check: private.mcp_* stays revoked from anon and authenticated.
-- PostgREST exposes public and graphql_public only. LOGIN passwords and client
-- rows are not created here. Edge flags stay off until set as secrets.
-- Independent opaque OAuth tokens: no Supabase user JWT is issued to the MCP client.
DO $$ BEGIN
    CREATE ROLE firstcrack_mcp_store NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    CREATE ROLE firstcrack_mcp_issuer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    CREATE ROLE firstcrack_mcp_gateway NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    CREATE ROLE firstcrack_mcp_data NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
END $$;
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO firstcrack_mcp_store, firstcrack_mcp_issuer, firstcrack_mcp_gateway, firstcrack_mcp_data;
GRANT CREATE ON SCHEMA private TO firstcrack_mcp_store, firstcrack_mcp_data;
GRANT USAGE ON SCHEMA public, auth TO firstcrack_mcp_store, firstcrack_mcp_data;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), public.has_workspace_access(uuid) TO firstcrack_mcp_store, firstcrack_mcp_data;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid), public.is_org_member_or_owner(uuid) TO firstcrack_mcp_data;

CREATE TABLE private.mcp_clients (
    id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    issuer text NOT NULL CHECK (issuer LIKE 'https://%'),
    resource text NOT NULL CHECK (resource LIKE 'https://%'),
    redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
    enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE private.mcp_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES private.mcp_clients(id),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workspace_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scope text NOT NULL DEFAULT 'firstcrack:read' CHECK (scope = 'firstcrack:read'),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
    revoked_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX mcp_grants_user_idx ON private.mcp_grants(user_id, created_at DESC);
CREATE TABLE private.mcp_authorizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES private.mcp_clients(id),
    redirect_uri text NOT NULL,
    state text NOT NULL CHECK (length(state) BETWEEN 1 AND 1024),
    challenge text NOT NULL CHECK (challenge ~ '^[A-Za-z0-9_-]{43}$'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'used')),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
    grant_id uuid REFERENCES private.mcp_grants(id) ON DELETE CASCADE,
    code_hash text UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    code_expires_at timestamptz
);
CREATE INDEX mcp_authorizations_pending_idx ON private.mcp_authorizations(client_id, expires_at) WHERE status = 'pending';
CREATE TABLE private.mcp_tokens (
    hash text PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
    grant_id uuid NOT NULL REFERENCES private.mcp_grants(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('access', 'refresh')),
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    CHECK (expires_at > issued_at)
);
CREATE INDEX mcp_tokens_grant_idx ON private.mcp_tokens(grant_id);
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['mcp_clients', 'mcp_grants', 'mcp_authorizations', 'mcp_tokens'] LOOP
        EXECUTE format('ALTER TABLE private.%I OWNER TO firstcrack_mcp_store', table_name);
        EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC, anon, authenticated, firstcrack_mcp_issuer, firstcrack_mcp_gateway, firstcrack_mcp_data', table_name);
    END LOOP;
END $$;

ALTER TABLE private.mcp_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mcp_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mcp_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mcp_tokens ENABLE ROW LEVEL SECURITY;

-- The owner has authority over private grant records only, never over customer tables.
-- The runtime issuer role can execute this dispatcher but cannot read token/client tables.
CREATE FUNCTION private.mcp_oauth(action text, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    c private.mcp_clients%ROWTYPE;
    a private.mcp_authorizations%ROWTYPE;
    g private.mcp_grants%ROWTYPE;
    t private.mcp_tokens%ROWTYPE;
    gid uuid;
    actor uuid;
    owner_id uuid;
    result jsonb;
BEGIN
    IF action IN ('start', 'exchange', 'refresh', 'revoke') THEN
        SELECT * INTO c FROM private.mcp_clients WHERE id = p ->> 'client_id' AND enabled
            AND issuer = p ->> 'issuer' AND resource = p ->> 'resource';
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_client'); END IF;
    END IF;
    IF action = 'start' THEN
        IF ((p ->> 'redirect_uri') = ANY(c.redirect_uris)) IS DISTINCT FROM true THEN RETURN jsonb_build_object('error', 'invalid_request'); END IF;
        -- Serialize the small pending-request budget per registered client.
        PERFORM 1 FROM private.mcp_clients WHERE id = c.id FOR UPDATE;
        IF (SELECT count(*) FROM private.mcp_authorizations WHERE client_id = c.id AND status = 'pending' AND expires_at > now()) >= 1000 THEN
            RETURN jsonb_build_object('error', 'temporarily_unavailable', 'status', 429);
        END IF;
        INSERT INTO private.mcp_authorizations(client_id, redirect_uri, state, challenge)
            VALUES(c.id, p ->> 'redirect_uri', p ->> 'state', p ->> 'challenge') RETURNING id INTO gid;
        RETURN jsonb_build_object('authorization_id', gid);
    END IF;
    IF action IN ('details', 'approve', 'deny') THEN
        actor := (p ->> 'user_id')::uuid;
        IF actor IS NULL THEN RETURN jsonb_build_object('error', 'access_denied', 'status', 403); END IF;
        SELECT * INTO a FROM private.mcp_authorizations WHERE id = (p ->> 'authorization_id')::uuid FOR UPDATE;
        IF NOT FOUND OR a.status <> 'pending' OR a.expires_at <= now() THEN RETURN jsonb_build_object('error', 'invalid_request'); END IF;
        SELECT * INTO c FROM private.mcp_clients WHERE id = a.client_id AND enabled
            AND issuer = p ->> 'issuer' AND resource = p ->> 'resource';
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_client'); END IF;
        IF action = 'details' THEN
            RETURN jsonb_build_object('authorization_id', a.id, 'redirect_uri', a.redirect_uri,
                'client', jsonb_build_object('id', c.id, 'name', c.name));
        END IF;
        IF action = 'deny' THEN
            UPDATE private.mcp_authorizations SET status = 'denied' WHERE id = a.id;
        ELSE
            owner_id := (p ->> 'workspace_owner_id')::uuid;
            PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::text, true);
            PERFORM set_config('request.jwt.claim.sub', actor::text, true);
            PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
            IF owner_id IS NULL OR public.has_workspace_access(owner_id) IS DISTINCT FROM true THEN
                RETURN jsonb_build_object('error', 'access_denied', 'status', 403);
            END IF;
            INSERT INTO private.mcp_grants(client_id, user_id, workspace_owner_id)
                VALUES(c.id, actor, owner_id) RETURNING id INTO gid;
            UPDATE private.mcp_authorizations SET status = 'approved', grant_id = gid,
                code_hash = p ->> 'code_hash', code_expires_at = now() + interval '2 minutes' WHERE id = a.id;
        END IF;
        RETURN jsonb_build_object('redirect_uri', a.redirect_uri, 'state', a.state);
    END IF;
    IF action = 'exchange' THEN
        SELECT * INTO a FROM private.mcp_authorizations WHERE code_hash = p ->> 'source_hash' FOR UPDATE;
        IF NOT FOUND OR a.client_id IS DISTINCT FROM c.id OR a.redirect_uri IS DISTINCT FROM p ->> 'redirect_uri'
           OR a.challenge IS DISTINCT FROM p ->> 'challenge' THEN RETURN jsonb_build_object('error', 'invalid_grant'); END IF;
        SELECT * INTO g FROM private.mcp_grants WHERE id = a.grant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_grant'); END IF;
        IF a.status = 'used' THEN
            UPDATE private.mcp_grants SET revoked_at = coalesce(revoked_at, now()) WHERE id = g.id;
            RETURN jsonb_build_object('error', 'invalid_grant'); -- Commit replay revocation; do not raise/roll it back.
        END IF;
        IF a.status <> 'approved' OR a.code_expires_at <= now() OR g.revoked_at IS NOT NULL OR g.expires_at <= now() THEN
            RETURN jsonb_build_object('error', 'invalid_grant');
        END IF;
        UPDATE private.mcp_authorizations SET status = 'used' WHERE id = a.id;
    ELSIF action = 'refresh' THEN
        SELECT grant_id INTO gid FROM private.mcp_tokens WHERE hash = p ->> 'source_hash' AND kind = 'refresh';
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_grant'); END IF;
        -- Consistent grant-first locking serializes rotation and revocation.
        SELECT * INTO g FROM private.mcp_grants WHERE id = gid FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invalid_grant'); END IF;
        SELECT * INTO t FROM private.mcp_tokens WHERE hash = p ->> 'source_hash' FOR UPDATE;
        IF g.client_id <> c.id OR g.revoked_at IS NOT NULL OR g.expires_at <= now() OR t.expires_at <= now() THEN
            RETURN jsonb_build_object('error', 'invalid_grant');
        END IF;
        IF t.used_at IS NOT NULL THEN
            UPDATE private.mcp_grants SET revoked_at = now() WHERE id = g.id;
            RETURN jsonb_build_object('error', 'invalid_grant');
        END IF;
        UPDATE private.mcp_tokens SET used_at = now() WHERE hash = t.hash;
    ELSIF action = 'revoke' THEN
        UPDATE private.mcp_grants SET revoked_at = coalesce(revoked_at, now()) WHERE client_id = c.id
            AND id IN (SELECT grant_id FROM private.mcp_tokens WHERE hash = p ->> 'source_hash');
        RETURN '{}'::jsonb;
    ELSIF action IN ('grants', 'revoke_grant') THEN
        actor := (p ->> 'user_id')::uuid;
        IF actor IS NULL THEN RETURN jsonb_build_object('error', 'access_denied', 'status', 403); END IF;
        IF action = 'revoke_grant' THEN
            UPDATE private.mcp_grants SET revoked_at = coalesce(revoked_at, now())
                WHERE id = (p ->> 'grant_id')::uuid AND user_id = actor
                AND client_id IN (SELECT id FROM private.mcp_clients WHERE issuer = p ->> 'issuer' AND resource = p ->> 'resource');
            RETURN '{}'::jsonb; -- No existence oracle for another user's grant.
        END IF;
        SELECT coalesce(jsonb_agg(row_to_json(q) ORDER BY q.created_at DESC), '[]'::jsonb) INTO result FROM (
            SELECT gr.id, gr.workspace_owner_id, gr.created_at, gr.expires_at, gr.revoked_at, cl.name AS client_name
            FROM private.mcp_grants gr JOIN private.mcp_clients cl ON cl.id = gr.client_id
            WHERE gr.user_id = actor AND cl.issuer = p ->> 'issuer' AND cl.resource = p ->> 'resource'
            ORDER BY gr.created_at DESC LIMIT 100
        ) q;
        RETURN jsonb_build_object('grants', result);
    ELSE
        RETURN jsonb_build_object('error', 'invalid_request');
    END IF;
    -- Shared final step for initial issuance and rotation. Scope/owner never come from a refresh request.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', g.user_id, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', g.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    IF public.has_workspace_access(g.workspace_owner_id) IS DISTINCT FROM true THEN
        UPDATE private.mcp_grants SET revoked_at = coalesce(revoked_at, now()) WHERE id = g.id;
        RETURN jsonb_build_object('error', 'invalid_grant');
    END IF;
    INSERT INTO private.mcp_tokens(hash, grant_id, kind, expires_at) VALUES
        (p ->> 'access_hash', g.id, 'access', least(now() + interval '5 minutes', g.expires_at)),
        (p ->> 'refresh_hash', g.id, 'refresh', g.expires_at);
    RETURN jsonb_build_object('expires_in', least(300, greatest(0, floor(extract(epoch FROM g.expires_at - now())))::integer));
END $$;
ALTER FUNCTION private.mcp_oauth(text, jsonb) OWNER TO firstcrack_mcp_store;
REVOKE ALL ON FUNCTION private.mcp_oauth(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mcp_oauth(text, jsonb) TO firstcrack_mcp_issuer;

CREATE FUNCTION private.mcp_access(token_hash text, expected_issuer text, expected_resource text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE g private.mcp_grants%ROWTYPE; t private.mcp_tokens%ROWTYPE; c private.mcp_clients%ROWTYPE;
BEGIN
    SELECT * INTO t FROM private.mcp_tokens WHERE hash = token_hash AND kind = 'access' AND expires_at > now();
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO g FROM private.mcp_grants WHERE id = t.grant_id AND revoked_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO c FROM private.mcp_clients WHERE id = g.client_id AND enabled AND issuer = expected_issuer AND resource = expected_resource;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', g.user_id, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', g.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    IF public.has_workspace_access(g.workspace_owner_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('iss', c.issuer, 'aud', c.resource, 'sub', g.user_id,
        'client_id', c.id, 'scope', g.scope, 'role', 'firstcrack_mcp_data', 'firstcrack_access', 'read',
        'firstcrack_workspace_owner_id', g.workspace_owner_id,
        'iat', floor(extract(epoch FROM t.issued_at)), 'exp', floor(extract(epoch FROM least(t.expires_at, g.expires_at))));
END $$;
ALTER FUNCTION private.mcp_access(text, text, text) OWNER TO firstcrack_mcp_store;
REVOKE ALL ON FUNCTION private.mcp_access(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mcp_access(text, text, text) TO firstcrack_mcp_gateway, firstcrack_mcp_data;

-- Customer queries run as a non-owner, non-bypass role. Neither runtime role receives table SELECT.
GRANT SELECT(id, display_name, business_name, country_code, plan) ON public.profiles TO firstcrack_mcp_data;
GRANT SELECT(id, owner_id, name) ON public.organizations TO firstcrack_mcp_data;
GRANT SELECT(id, user_id, name, origin, low_stock_threshold_grams) ON public.beans TO firstcrack_mcp_data;
GRANT SELECT(user_id, bean_id, delta_grams, event_type) ON public.bean_stock_events TO firstcrack_mcp_data;
GRANT SELECT(user_id, bean_id, blend_id, delta_grams) ON public.roasted_stock_events TO firstcrack_mcp_data;
GRANT SELECT(id, user_id, name, sku, is_active) ON public.products TO firstcrack_mcp_data;
GRANT SELECT(user_id, product_id, delta_units) ON public.product_stock_events TO firstcrack_mcp_data;
GRANT SELECT(id, user_id, platform, platform_order_id, status, ordered_at, fulfilled_at) ON public.orders TO firstcrack_mcp_data;
GRANT SELECT(id, user_id, order_id, product_id, title, quantity, status) ON public.order_lines TO firstcrack_mcp_data;
DO $$ DECLARE table_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['profiles', 'organizations', 'beans', 'bean_stock_events', 'roasted_stock_events', 'products', 'product_stock_events', 'orders', 'order_lines'] LOOP
        IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity) THEN
            RAISE EXCEPTION 'RLS required for %', table_name;
        END IF;
    END LOOP;
    FOREACH table_name IN ARRAY ARRAY['beans', 'bean_stock_events', 'roasted_stock_events', 'products', 'product_stock_events', 'orders', 'order_lines'] LOOP
        EXECUTE format('CREATE POLICY mcp_grant_scope ON public.%I AS RESTRICTIVE FOR SELECT TO firstcrack_mcp_data
            USING (user_id = (auth.jwt() ->> ''firstcrack_workspace_owner_id'')::uuid AND public.has_workspace_access(user_id))', table_name);
    END LOOP;
END $$;
CREATE POLICY mcp_self_profile ON public.profiles FOR SELECT TO firstcrack_mcp_data USING(id = auth.uid());
CREATE POLICY mcp_self_profile_scope ON public.profiles AS RESTRICTIVE FOR SELECT TO firstcrack_mcp_data USING(
    id = auth.uid() OR id = (auth.jwt() ->> 'firstcrack_workspace_owner_id')::uuid);
CREATE POLICY mcp_owner_plan ON public.profiles FOR SELECT TO firstcrack_mcp_data
    USING(id = (auth.jwt() ->> 'firstcrack_workspace_owner_id')::uuid);
CREATE POLICY mcp_org_scope ON public.organizations AS RESTRICTIVE FOR SELECT TO firstcrack_mcp_data
    USING(owner_id = (auth.jwt() ->> 'firstcrack_workspace_owner_id')::uuid AND public.has_workspace_access(owner_id));

CREATE FUNCTION private.mcp_read(token_hash text, expected_issuer text, expected_resource text, tool text, args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE proof jsonb; v_owner_id uuid; subject_id uuid; lim integer; off integer; result jsonb; v_plan text;
BEGIN
    proof := private.mcp_access(token_hash, expected_issuer, expected_resource);
    IF proof IS NULL THEN RETURN jsonb_build_object('error', 'invalid_token'); END IF;
    IF jsonb_typeof(args) IS DISTINCT FROM 'object' OR (args - 'limit' - 'offset' - 'workspace_owner_id') <> '{}'::jsonb
       OR coalesce(args ->> 'limit', '50') !~ '^[0-9]+$' OR coalesce(args ->> 'offset', '0') !~ '^[0-9]+$' THEN
        RETURN jsonb_build_object('error', 'invalid_request');
    END IF;
    lim := coalesce(args ->> 'limit', '50')::integer; off := coalesce(args ->> 'offset', '0')::integer;
    IF lim NOT BETWEEN 1 AND 100 OR off NOT BETWEEN 0 AND 10000 THEN RETURN jsonb_build_object('error', 'invalid_request'); END IF;
    v_owner_id := (proof ->> 'firstcrack_workspace_owner_id')::uuid; subject_id := (proof ->> 'sub')::uuid;
    IF args ? 'workspace_owner_id' AND args ->> 'workspace_owner_id' IS DISTINCT FROM v_owner_id::text THEN RETURN jsonb_build_object('error', 'access_denied'); END IF;
    -- Even a caller with this function's execution credential cannot choose its own user context.
    PERFORM set_config('request.jwt.claims', proof::text, true);
    PERFORM set_config('request.jwt.claim.sub', subject_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'firstcrack_mcp_data', true);
    PERFORM set_config('transaction_read_only', 'on', true);
    SELECT plan INTO v_plan FROM public.profiles WHERE id = v_owner_id;
    IF v_plan IS NULL OR v_plan NOT IN ('pro', 'pro_plus', 'enterprise', 'team', 'tester') THEN
        RETURN jsonb_build_object('error', 'insufficient_plan');
    END IF;
    CASE tool
    WHEN 'get_my_profile' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (SELECT id, display_name, business_name, country_code FROM public.profiles WHERE id = subject_id ORDER BY id LIMIT lim + 1 OFFSET off) q;
    WHEN 'list_my_workspaces' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (SELECT o.id, o.owner_id, o.name FROM public.organizations o WHERE o.owner_id = v_owner_id ORDER BY o.id LIMIT lim + 1 OFFSET off) q;
    WHEN 'list_green_stock' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (
            SELECT b.id, b.name, b.origin, b.low_stock_threshold_grams,
                coalesce((SELECT sum(e.delta_grams)::integer FROM public.bean_stock_events e
                    WHERE e.bean_id = b.id AND e.user_id = v_owner_id AND e.event_type IS DISTINCT FROM 'expected_inbound'), 0) AS on_hand_grams
            FROM public.beans b WHERE b.user_id = v_owner_id ORDER BY b.id LIMIT lim + 1 OFFSET off
        ) q;
    WHEN 'list_roasted_stock' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (
            SELECT e.bean_id, e.blend_id, coalesce(sum(e.delta_grams), 0)::integer AS on_hand_grams
            FROM public.roasted_stock_events e WHERE e.user_id = v_owner_id
            GROUP BY e.bean_id, e.blend_id ORDER BY e.bean_id, e.blend_id LIMIT lim + 1 OFFSET off
        ) q;
    WHEN 'list_product_stock' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (
            SELECT p.id, p.name, p.sku, p.is_active,
                coalesce((SELECT sum(e.delta_units)::integer FROM public.product_stock_events e
                    WHERE e.product_id = p.id AND e.user_id = v_owner_id), 0) AS on_hand_units
            FROM public.products p WHERE p.user_id = v_owner_id ORDER BY p.id LIMIT lim + 1 OFFSET off
        ) q;
    WHEN 'list_orders' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO result FROM (
            SELECT o.id, o.platform, o.platform_order_id, o.status, o.ordered_at, o.fulfilled_at,
                (SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) FROM (SELECT id, product_id, title, quantity, status FROM public.order_lines WHERE order_id = o.id AND user_id = v_owner_id ORDER BY id LIMIT 1000) l) AS order_lines
            FROM public.orders o WHERE o.user_id = v_owner_id ORDER BY o.id LIMIT lim + 1 OFFSET off
        ) q;
    ELSE RETURN jsonb_build_object('error', 'invalid_request');
    END CASE;
    RETURN jsonb_build_object('rows', result);
END $$;
ALTER FUNCTION private.mcp_read(text, text, text, text, jsonb) OWNER TO firstcrack_mcp_data;
REVOKE ALL ON FUNCTION private.mcp_read(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mcp_read(text, text, text, text, jsonb) TO firstcrack_mcp_gateway;
REVOKE CREATE ON SCHEMA private FROM firstcrack_mcp_store, firstcrack_mcp_data;

-- Provision separate server-only LOGIN credentials as members of the issuer/gateway
-- roles only after approval. Do not grant runtime membership of store/data owner roles.
-- Register exact clients/redirect URIs out of band; dynamic client registration is absent.
