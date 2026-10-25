-- ISOLATED SCRATCH DB ONLY. Run after firstcrack-reader-boundary.sql in that fixture DB.
\set ON_ERROR_STOP on
CREATE ROLE supabase_auth_admin NOLOGIN;
\ir ../proposals/firstcrack-oauth-token-hook.sql
INSERT INTO private.firstcrack_oauth_clients VALUES (
    '44444444-4444-4444-8444-444444444444', 'https://resource.example/functions/v1/firstcrack-mcp', true);
SET ROLE supabase_auth_admin;
DO $$
DECLARE
    native_event jsonb := '{"user_id":"11111111-1111-4111-8111-111111111111","authentication_method":"oauth","claims":{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aud":"authenticated"}}';
    oauth_event jsonb;
    issued jsonb;
    invalid jsonb;
BEGIN
    IF private.firstcrack_oauth_token_hook(native_event) <> native_event THEN
        RAISE EXCEPTION 'native desktop/web login changed';
    END IF;
    oauth_event := native_event || jsonb_build_object('authentication_method', 'oauth_provider/authorization_code',
        'claims', (native_event -> 'claims') || '{"client_id":"44444444-4444-4444-8444-444444444444","scope":"openid","user_metadata":{"firstcrack_workspace_owner_id":"22222222-2222-4222-8222-222222222222"}}'::jsonb);
    issued := private.firstcrack_oauth_token_hook(oauth_event) -> 'claims';
    IF issued ->> 'role' <> 'firstcrack_reader' OR issued ->> 'scope' <> 'openid'
       OR issued ->> 'firstcrack_access' <> 'read'
       OR issued ->> 'firstcrack_workspace_owner_id' <> oauth_event ->> 'user_id'
       OR NOT (issued -> 'aud' ? 'https://resource.example/functions/v1/firstcrack-mcp') THEN
        RAISE EXCEPTION 'read credential issuance failed';
    END IF;
    -- Refresh retains the same identity-derived workspace; edited metadata cannot switch it.
    issued := private.firstcrack_oauth_token_hook(jsonb_set(oauth_event, '{authentication_method}', '"token_refresh"')) -> 'claims';
    IF issued ->> 'firstcrack_workspace_owner_id' <> oauth_event ->> 'user_id'
       OR issued ->> 'role' <> 'firstcrack_reader' THEN
        RAISE EXCEPTION 'refresh expanded access';
    END IF;
    FOREACH invalid IN ARRAY ARRAY[
        jsonb_set(oauth_event, '{claims,scope}', '"email"'),
        jsonb_set(oauth_event, '{claims,client_id}', '"55555555-5555-4555-8555-555555555555"'),
        jsonb_set(oauth_event, '{user_id}', '"22222222-2222-4222-8222-222222222222"'),
        oauth_event #- '{claims,client_id}'
    ] LOOP
        BEGIN
            PERFORM private.firstcrack_oauth_token_hook(invalid);
            RAISE EXCEPTION 'invalid OAuth identity/scope/client accepted';
        EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END LOOP;
END $$;
RESET ROLE;
SET ROLE firstcrack_reader;
DO $$ BEGIN
    BEGIN
        PERFORM private.firstcrack_oauth_token_hook('{}');
        RAISE EXCEPTION 'reader can mint claims';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        PERFORM client_id FROM private.firstcrack_oauth_clients;
        RAISE EXCEPTION 'reader can read issuer configuration';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'firstcrack OAuth hook scratch checks passed' AS result;
