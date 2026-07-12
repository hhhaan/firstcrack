-- Admin-only helper: session IP aggregates for geo map (service_role only)
CREATE OR REPLACE FUNCTION public.admin_auth_session_ips()
RETURNS TABLE (
  ip text,
  session_count bigint,
  user_count bigint,
  last_seen timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT
    host(s.ip)::text AS ip,
    count(*)::bigint AS session_count,
    count(DISTINCT s.user_id)::bigint AS user_count,
    max(s.updated_at) AS last_seen
  FROM auth.sessions s
  WHERE s.ip IS NOT NULL
  GROUP BY host(s.ip);
$$;

COMMENT ON FUNCTION public.admin_auth_session_ips() IS 'Admin dashboard: aggregate auth.sessions by IP for geo activity map';

REVOKE ALL ON FUNCTION public.admin_auth_session_ips() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_auth_session_ips() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auth_session_ips() TO service_role;

-- Admin user roster joining auth.users + profiles
CREATE OR REPLACE FUNCTION public.admin_user_roster()
RETURNS TABLE (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  provider text,
  display_name text,
  business_name text,
  plan text,
  polar_customer_id text,
  roast_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    coalesce(u.raw_app_meta_data->>'provider', 'email')::text AS provider,
    p.display_name,
    p.business_name,
    coalesce(p.plan, 'unknown')::text AS plan,
    p.polar_customer_id,
    coalesce(rs.cnt, 0)::bigint AS roast_count
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN (
    SELECT user_id, count(*) AS cnt
    FROM public.roast_sessions
    GROUP BY user_id
  ) rs ON rs.user_id = u.id
  WHERE u.deleted_at IS NULL
  ORDER BY u.created_at DESC;
$$;

COMMENT ON FUNCTION public.admin_user_roster() IS 'Admin dashboard: user list with plan and roast counts';

REVOKE ALL ON FUNCTION public.admin_user_roster() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_roster() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_roster() TO service_role;
;
