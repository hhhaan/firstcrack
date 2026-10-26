-- SUPERSEDED EXPERIMENT: do not activate for external MCP credentials.
-- Use migration 20261026120000_firstcrack_mcp_read_issuer.sql; native Auth tokens are not isolated read-only credentials.
-- REVIEW PROPOSAL ONLY. Never applied by migrations or enabled in Auth automatically.
-- NOT A SAFE EXTERNAL CREDENTIAL BOUNDARY: DB role/RLS cannot restrict the managed
-- Auth service's own account mutation endpoints. Do not activate this native-token
-- approach for the plugin; use an independently scoped issuer/credential boundary.
-- Apply and verify the reader role, RLS, PostgREST guard and existing EF protection FIRST.
-- This first consent flow is SELF WORKSPACE ONLY. It creates no team-workspace grant.
CREATE TABLE private.firstcrack_oauth_clients (
    client_id uuid PRIMARY KEY,
    resource_url text NOT NULL CHECK (resource_url LIKE 'https://%'),
    enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE private.firstcrack_oauth_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.firstcrack_oauth_clients FROM PUBLIC, anon, authenticated, firstcrack_reader;
GRANT USAGE ON SCHEMA private TO supabase_auth_admin;
GRANT SELECT ON private.firstcrack_oauth_clients TO supabase_auth_admin;
CREATE POLICY auth_hook_client_config ON private.firstcrack_oauth_clients
    FOR SELECT TO supabase_auth_admin USING (true);

CREATE FUNCTION private.firstcrack_oauth_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
    claims jsonb := event -> 'claims';
    v_client_id text := nullif(claims ->> 'client_id', '');
    resource text;
    subject_id uuid;
BEGIN
    IF v_client_id IS NULL THEN
        IF event ->> 'authentication_method' LIKE 'oauth_provider/%' THEN
            RAISE insufficient_privilege USING MESSAGE = 'OAuth client binding missing';
        END IF;
        RETURN event; -- Existing password/social-provider desktop/web sessions are unchanged.
    END IF;
    SELECT c.resource_url INTO resource FROM private.firstcrack_oauth_clients c
        WHERE c.client_id = v_client_id::uuid AND c.enabled;
    IF resource IS NULL THEN
        RAISE insufficient_privilege USING MESSAGE = 'OAuth client not approved for read access';
    END IF;
    subject_id := (claims ->> 'sub')::uuid;
    IF subject_id IS NULL OR subject_id IS DISTINCT FROM (event ->> 'user_id')::uuid
       OR claims ->> 'is_anonymous' = 'true'
       OR NOT ('openid' = ANY(regexp_split_to_array(coalesce(claims ->> 'scope', ''), '\s+'))) THEN
        RAISE insufficient_privilege USING MESSAGE = 'Invalid read access identity';
    END IF;
    -- Standard OIDC scope is not a database permission. These signed server claims
    -- and the non-inheriting DB role enforce the application's read permission.
    claims := claims || jsonb_build_object(
        'role', 'firstcrack_reader',
        'aud', jsonb_build_array('authenticated', resource),
        'firstcrack_access', 'read',
        'firstcrack_workspace_owner_id', subject_id::text
    );
    RETURN jsonb_set(event, '{claims}', claims);
END $$;
REVOKE ALL ON FUNCTION private.firstcrack_oauth_token_hook(jsonb) FROM PUBLIC, anon, authenticated, firstcrack_reader;
GRANT EXECUTE ON FUNCTION private.firstcrack_oauth_token_hook(jsonb) TO supabase_auth_admin;

-- Approval-required: register the exact existing-host OAuth client, insert its verified
-- client ID/resource into this private table, and configure the hosted Custom Access
-- Token Hook. Do not replace another hook; compose after reviewing its source.
-- Test authorization-code and refresh issuance before enabling the consent page.
