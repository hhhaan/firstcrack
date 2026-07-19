-- Member directory for Team settings: name + email (auth.users), not bare user ids.
-- SECURITY DEFINER so co-members can resolve emails; gated by org membership.

CREATE OR REPLACE FUNCTION public.list_org_members(p_org_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text,
  created_at timestamptz,
  display_name text,
  business_name text,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    m.user_id,
    m.role,
    m.created_at,
    p.display_name,
    p.business_name,
    u.email::text
  FROM public.organization_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.org_id = p_org_id
    AND public.is_org_member_or_owner(p_org_id)
  ORDER BY m.created_at;
$$;

COMMENT ON FUNCTION public.list_org_members(uuid) IS
  'Org member directory with display name + email. Caller must be member or owner.';

REVOKE ALL ON FUNCTION public.list_org_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_org_members(uuid) TO authenticated;
