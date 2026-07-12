-- Admin-only helper: per-user auth session activity (service_role only)
CREATE OR REPLACE FUNCTION public.admin_auth_user_activity()
RETURNS TABLE (
  user_id uuid,
  last_seen timestamptz,
  session_count bigint,
  last_ip text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT
    s.user_id,
    max(s.updated_at) AS last_seen,
    count(*)::bigint AS session_count,
    (
      SELECT host(s2.ip)::text
      FROM auth.sessions s2
      WHERE s2.user_id = s.user_id
        AND s2.ip IS NOT NULL
      ORDER BY s2.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS last_ip
  FROM auth.sessions s
  GROUP BY s.user_id
  ORDER BY last_seen DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.admin_auth_user_activity() IS
  'Admin dashboard: per-user auth.sessions rollup for activity tracking';

REVOKE ALL ON FUNCTION public.admin_auth_user_activity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_auth_user_activity() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auth_user_activity() TO service_role;;
