-- Bug: create_org_invite auto-created orgs with seat_limit=1, inserted the owner
-- as a member, then checked member_count+pending+1 > seat_limit → always fails.
-- Ops docs assumed first invite would create the org successfully; it never could.
--
-- Fix: enterprise/team owners get a usable default seat_limit on auto-create,
-- and existing stuck enterprise orgs (seat_limit=1) are bumped.

-- Default seats included when an enterprise org is first created via invite RPC.
-- Ops can still raise/lower via service_role SQL after commercial close.

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
  -- Team invites are enterprise-class only (legacy plan value: team).
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

    -- Owner occupies 1 seat; default must leave room for at least one invite.
    v_default_seats := 5;

    INSERT INTO organizations (owner_id, name, seat_limit)
    VALUES (v_uid, COALESCE(v_name, 'My Roastery'), v_default_seats)
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

-- Unstick enterprise owners who already hit the seat_limit=1 dead-end.
UPDATE public.organizations o
SET seat_limit = 5
FROM public.profiles p
WHERE o.owner_id = p.id
  AND p.plan IN ('enterprise', 'team')
  AND o.seat_limit = 1;
