-- Do not apply this file.
-- The read-only issuer is supabase/migrations/20261026120000_firstcrack_mcp_read_issuer.sql.
-- Release or Actions → Deploy migrations applies it. Applying this file as well would run the same SQL twice.
-- firstcrack-reader.sql and firstcrack-oauth-token-hook.sql stay unused.
DO $$ BEGIN
    RAISE EXCEPTION 'use migration 20261026120000_firstcrack_mcp_read_issuer.sql';
END $$;
