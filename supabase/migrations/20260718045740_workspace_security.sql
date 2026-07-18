-- Hardening for team workspaces: grants, RLS helpers, seat locks, revoke RPC

-- ── Helpers (avoid RLS mutual recursion) ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = p_org_id AND o.owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member_or_owner(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_org_owner(p_org_id)
      OR EXISTS (
           SELECT 1 FROM organization_members m
           WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
         );
$$;

REVOKE ALL ON FUNCTION public.is_org_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_org_member_or_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member_or_owner(uuid) TO authenticated;

-- Replace org policies to use helpers
DROP POLICY IF EXISTS "orgs select member or owner" ON public.organizations;
DROP POLICY IF EXISTS "orgs insert owner" ON public.organizations;
DROP POLICY IF EXISTS "orgs update owner" ON public.organizations;
DROP POLICY IF EXISTS "orgs delete owner" ON public.organizations;

CREATE POLICY "orgs select member or owner" ON public.organizations
  FOR SELECT USING (public.is_org_member_or_owner(id));
-- No client INSERT/UPDATE/DELETE: org create is via create_org_invite; seat_limit via service_role only

DROP POLICY IF EXISTS "org_members select self or owner" ON public.organization_members;
DROP POLICY IF EXISTS "org_members delete owner or self" ON public.organization_members;

CREATE POLICY "org_members select self or owner" ON public.organization_members
  FOR SELECT USING (
    user_id = auth.uid() OR public.is_org_owner(org_id)
  );
CREATE POLICY "org_members delete owner or self" ON public.organization_members
  FOR DELETE USING (
    user_id = auth.uid() OR public.is_org_owner(org_id)
  );

DROP POLICY IF EXISTS "org_invites owner all" ON public.organization_invites;
CREATE POLICY "org_invites select owner" ON public.organization_invites
  FOR SELECT USING (public.is_org_owner(org_id));
-- Writes only via SECURITY DEFINER RPCs

-- Restrict table grants: SELECT only for orgs/invites; members SELECT+DELETE already covered
REVOKE INSERT, UPDATE, DELETE ON public.organizations FROM authenticated;
GRANT SELECT ON public.organizations TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.organization_invites FROM authenticated;
GRANT SELECT ON public.organization_invites TO authenticated;

REVOKE INSERT, UPDATE ON public.organization_members FROM authenticated;
GRANT SELECT, DELETE ON public.organization_members TO authenticated;

-- ── revoke_org_invite RPC ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.revoke_org_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT org_id INTO v_org_id
  FROM organization_invites
  WHERE id = p_invite_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;
  IF NOT public.is_org_owner(v_org_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  UPDATE organization_invites
  SET revoked_at = now()
  WHERE id = p_invite_id AND revoked_at IS NULL AND accepted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_org_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_org_invite(uuid) TO authenticated;

-- ── Seat race: lock org row ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_token text,
  p_expires_in interval DEFAULT '7 days'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_seat_limit integer;
  v_member_count integer;
  v_pending_count integer;
  v_name text;
  v_invite_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  SELECT id, seat_limit INTO v_org_id, v_seat_limit
  FROM organizations
  WHERE owner_id = v_uid
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    SELECT COALESCE(nullif(trim(business_name), ''), 'My Roastery')
    INTO v_name
    FROM profiles
    WHERE id = v_uid;

    INSERT INTO organizations (owner_id, name, seat_limit)
    VALUES (v_uid, COALESCE(v_name, 'My Roastery'), 1)
    RETURNING id, seat_limit INTO v_org_id, v_seat_limit;

    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'owner');

    -- re-lock after create
    SELECT id, seat_limit INTO v_org_id, v_seat_limit
    FROM organizations
    WHERE id = v_org_id
    FOR UPDATE;
  END IF;

  SELECT count(*)::integer INTO v_member_count
  FROM organization_members
  WHERE org_id = v_org_id;

  SELECT count(*)::integer INTO v_pending_count
  FROM organization_invites
  WHERE org_id = v_org_id
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF v_member_count + v_pending_count + 1 > v_seat_limit THEN
    RAISE EXCEPTION 'seat_limit_reached';
  END IF;

  INSERT INTO organization_invites (org_id, token, expires_at)
  VALUES (v_org_id, p_token, now() + p_expires_in)
  RETURNING id INTO v_invite_id;

  RETURN v_invite_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_org_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invite organization_invites%ROWTYPE;
  v_owner_id uuid;
  v_seat_limit integer;
  v_member_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT * INTO v_invite
  FROM organization_invites
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_revoked';
  END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_already_used';
  END IF;

  SELECT owner_id, seat_limit INTO v_owner_id, v_seat_limit
  FROM organizations
  WHERE id = v_invite.org_id
  FOR UPDATE;

  IF v_owner_id = v_uid THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_invite.org_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  SELECT count(*)::integer INTO v_member_count
  FROM organization_members
  WHERE org_id = v_invite.org_id;

  IF v_member_count + 1 > v_seat_limit THEN
    RAISE EXCEPTION 'seat_limit_reached';
  END IF;

  BEGIN
    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_invite.org_id, v_uid, 'member');
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'already_member';
  END;

  UPDATE organization_invites
  SET accepted_by = v_uid, accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_invite.org_id;
END;
$$;

-- Parent ownership on product_stock_events (same pattern as bean_stock_events)
DROP POLICY IF EXISTS "workspace access product_stock_events" ON public.product_stock_events;
CREATE POLICY "workspace access product_stock_events" ON public.product_stock_events
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (
    public.has_workspace_access(user_id)
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_stock_events.product_id
        AND public.has_workspace_access(p.user_id)
    )
  );
