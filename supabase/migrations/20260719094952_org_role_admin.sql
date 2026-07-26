-- Rename organization member role owner → admin (UI + role value).
-- organizations.owner_id stays (workspace host id column).
-- Drop CHECK first, then migrate rows, then re-add CHECK.

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_role_check;

UPDATE public.organization_members
SET role = 'admin'
WHERE role = 'owner';

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_role_check
  CHECK (role IN ('admin', 'member'));

-- Recreate invite RPC so new orgs get role=admin
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
  v_plan text;
  v_invite_id uuid;
  v_default_seats integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  SELECT plan INTO v_plan FROM profiles WHERE id = v_uid;
  IF v_plan IS NULL OR v_plan NOT IN ('enterprise', 'team') THEN
    RAISE EXCEPTION 'access_denied';
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

    v_default_seats := 5;

    INSERT INTO organizations (owner_id, name, seat_limit)
    VALUES (v_uid, COALESCE(v_name, 'My Roastery'), v_default_seats)
    RETURNING id, seat_limit INTO v_org_id, v_seat_limit;

    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

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
