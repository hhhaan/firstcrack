-- Team/Enterprise workspaces: orgs + membership RLS + invite RPCs
-- SoT: docs/team-workspaces.md

-- ── 1a. Tables ──────────────────────────────────────────────────────────────

CREATE TABLE public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  seat_limit  integer NOT NULL DEFAULT 1 CHECK (seat_limit > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_members (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX organization_members_user_id_idx ON public.organization_members (user_id);

CREATE TABLE public.organization_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_invites_org_id_idx ON public.organization_invites (org_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invites TO authenticated;
GRANT ALL ON public.organization_invites TO service_role;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orgs select member or owner" ON public.organizations
  FOR SELECT USING (
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.org_id = organizations.id AND m.user_id = auth.uid()
    )
  );
CREATE POLICY "orgs insert owner" ON public.organizations
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "orgs update owner" ON public.organizations
  FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "orgs delete owner" ON public.organizations
  FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "org_members select self or owner" ON public.organization_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = organization_members.org_id AND o.owner_id = auth.uid()
    )
  );
CREATE POLICY "org_members delete owner or self" ON public.organization_members
  FOR DELETE USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = organization_members.org_id AND o.owner_id = auth.uid()
    )
  );
-- INSERT via SECURITY DEFINER RPC only

CREATE POLICY "org_invites owner all" ON public.organization_invites
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = organization_invites.org_id AND o.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = organization_invites.org_id AND o.owner_id = auth.uid()
    )
  );

-- ── 1b. Helper ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_workspace_access(target_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = target_owner
      OR EXISTS (
           SELECT 1 FROM organizations o
           JOIN organization_members m ON m.org_id = o.id
           WHERE o.owner_id = target_owner AND m.user_id = auth.uid()
         );
$$;
REVOKE ALL ON FUNCTION public.has_workspace_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_workspace_access(uuid) TO service_role;

-- ── 1c. RLS bulk replace ────────────────────────────────────────────────────

-- beans (4-verb → FOR ALL)
DROP POLICY IF EXISTS "Users can view own beans" ON public.beans;
DROP POLICY IF EXISTS "Users can insert own beans" ON public.beans;
DROP POLICY IF EXISTS "Users can update own beans" ON public.beans;
DROP POLICY IF EXISTS "Users can delete own beans" ON public.beans;
CREATE POLICY "workspace access beans" ON public.beans
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

-- roast_profiles
DROP POLICY IF EXISTS "Users can view own roast profiles" ON public.roast_profiles;
DROP POLICY IF EXISTS "Users can insert own roast profiles" ON public.roast_profiles;
DROP POLICY IF EXISTS "Users can update own roast profiles" ON public.roast_profiles;
DROP POLICY IF EXISTS "Users can delete own roast profiles" ON public.roast_profiles;
CREATE POLICY "workspace access roast_profiles" ON public.roast_profiles
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

-- roast_sessions
DROP POLICY IF EXISTS "Users can view own roast sessions" ON public.roast_sessions;
DROP POLICY IF EXISTS "Users can insert own roast sessions" ON public.roast_sessions;
DROP POLICY IF EXISTS "Users can update own roast sessions" ON public.roast_sessions;
DROP POLICY IF EXISTS "Users can delete own roast sessions" ON public.roast_sessions;
CREATE POLICY "workspace access roast_sessions" ON public.roast_sessions
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

-- FOR ALL single-policy tables
DROP POLICY IF EXISTS "users can manage own recurrence_rules" ON public.recurrence_rules;
CREATE POLICY "workspace access recurrence_rules" ON public.recurrence_rules
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "users see own blends" ON public.blends;
CREATE POLICY "workspace access blends" ON public.blends
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "users manage own inventory_alerts" ON public.inventory_alerts;
CREATE POLICY "workspace access inventory_alerts" ON public.inventory_alerts
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "users see own products" ON public.products;
CREATE POLICY "workspace access products" ON public.products
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "users see own product stock events" ON public.product_stock_events;
CREATE POLICY "workspace access product_stock_events" ON public.product_stock_events
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "users see own orders" ON public.orders;
CREATE POLICY "workspace access orders" ON public.orders
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "users see own order lines" ON public.order_lines;
CREATE POLICY "workspace access order_lines" ON public.order_lines
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "users see own channel connections" ON public.sales_channel_connections;
CREATE POLICY "workspace access sales_channel_connections" ON public.sales_channel_connections
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

-- cuppings (4-verb → FOR ALL)
DROP POLICY IF EXISTS "Users can view own cuppings" ON public.cuppings;
DROP POLICY IF EXISTS "Users can insert own cuppings" ON public.cuppings;
DROP POLICY IF EXISTS "Users can update own cuppings" ON public.cuppings;
DROP POLICY IF EXISTS "Users can delete own cuppings" ON public.cuppings;
CREATE POLICY "workspace access cuppings" ON public.cuppings
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "Users can view own cupping invites" ON public.cupping_invites;
DROP POLICY IF EXISTS "Users can insert own cupping invites" ON public.cupping_invites;
DROP POLICY IF EXISTS "Users can update own cupping invites" ON public.cupping_invites;
DROP POLICY IF EXISTS "Users can delete own cupping invites" ON public.cupping_invites;
CREATE POLICY "workspace access cupping_invites" ON public.cupping_invites
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "Users can view own cupping events" ON public.cupping_events;
DROP POLICY IF EXISTS "Users can insert own cupping events" ON public.cupping_events;
DROP POLICY IF EXISTS "Users can update own cupping events" ON public.cupping_events;
DROP POLICY IF EXISTS "Users can delete own cupping events" ON public.cupping_events;
CREATE POLICY "workspace access cupping_events" ON public.cupping_events
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "Users can view own cupping samples" ON public.cupping_samples;
DROP POLICY IF EXISTS "Users can insert own cupping samples" ON public.cupping_samples;
DROP POLICY IF EXISTS "Users can update own cupping samples" ON public.cupping_samples;
DROP POLICY IF EXISTS "Users can delete own cupping samples" ON public.cupping_samples;
CREATE POLICY "workspace access cupping_samples" ON public.cupping_samples
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

-- SELECT-only
DROP POLICY IF EXISTS "users read own sync runs" ON public.order_sync_runs;
CREATE POLICY "workspace access order_sync_runs" ON public.order_sync_runs
  FOR SELECT USING (public.has_workspace_access(user_id));

DROP POLICY IF EXISTS "users read own dispatches" ON public.order_dispatches;
CREATE POLICY "workspace access order_dispatches" ON public.order_dispatches
  FOR SELECT USING (public.has_workspace_access(user_id));

-- Special: blend_components
DROP POLICY IF EXISTS "users see own blend_components" ON public.blend_components;
CREATE POLICY "workspace access blend_components" ON public.blend_components
  FOR ALL
  USING (
    blend_id IN (SELECT id FROM public.blends WHERE public.has_workspace_access(user_id))
  )
  WITH CHECK (
    blend_id IN (SELECT id FROM public.blends WHERE public.has_workspace_access(user_id))
  );

-- Special: bean_stock_events — keep bean ownership EXISTS, swap uid checks
DROP POLICY IF EXISTS "users see own stock events" ON public.bean_stock_events;
CREATE POLICY "users see own stock events" ON public.bean_stock_events
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (
    public.has_workspace_access(user_id)
    AND EXISTS (
      SELECT 1 FROM public.beans
      WHERE beans.id = bean_stock_events.bean_id
        AND public.has_workspace_access(beans.user_id)
    )
  );

-- ── 1d. p_user_id RPC guards ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_product_stock(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN (
    SELECT COALESCE(
      jsonb_object_agg(p.id::text, COALESCE(s.units, 0)),
      '{}'::jsonb
    )
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(delta_units)::integer AS units
      FROM product_stock_events
      GROUP BY product_id
    ) s ON s.product_id = p.id
    WHERE p.user_id = p_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_roasting_requirements(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN (
    WITH demand AS (
      SELECT ol.product_id, SUM(ol.quantity)::integer AS ordered_units
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
      WHERE ol.user_id = p_user_id
        AND ol.status = 'active'
        AND ol.product_id IS NOT NULL
        AND o.status IN ('paid', 'preparing')
        AND o.fulfilled_at IS NULL
      GROUP BY ol.product_id
    ),
    stock AS (
      SELECT product_id, SUM(delta_units)::integer AS units
      FROM product_stock_events
      GROUP BY product_id
    ),
    shortfall AS (
      SELECT
        d.product_id,
        d.ordered_units,
        COALESCE(st.units, 0) AS on_hand_units,
        GREATEST(0, d.ordered_units - COALESCE(st.units, 0)) AS shortfall_units,
        p.name,
        p.bean_id,
        p.blend_id,
        p.roast_profile_id,
        p.net_weight_grams,
        p.yield_pct
      FROM demand d
      JOIN products p ON p.id = d.product_id
      LEFT JOIN stock st ON st.product_id = d.product_id
    ),
    bean_demand AS (
      SELECT
        COALESCE(bc.bean_id, s.bean_id) AS bean_id,
        s.roast_profile_id,
        SUM(
          s.shortfall_units * s.net_weight_grams
          * COALESCE(bc.ratio_pct, 100) / 100
        ) AS roasted_grams,
        SUM(
          s.shortfall_units * s.net_weight_grams
          * COALESCE(bc.ratio_pct, 100) / 100 / s.yield_pct
        ) AS green_grams
      FROM shortfall s
      LEFT JOIN blend_components bc ON bc.blend_id = s.blend_id
      WHERE s.shortfall_units > 0
        AND (s.bean_id IS NOT NULL OR bc.bean_id IS NOT NULL)
      GROUP BY COALESCE(bc.bean_id, s.bean_id), s.roast_profile_id
    )
    SELECT jsonb_build_object(
      'products', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', s.product_id,
          'name', s.name,
          'ordered_units', s.ordered_units,
          'on_hand_units', s.on_hand_units,
          'shortfall_units', s.shortfall_units
        ) ORDER BY s.name)
        FROM shortfall s
      ), '[]'::jsonb),
      'beans', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'bean_id', bd.bean_id,
          'roast_profile_id', bd.roast_profile_id,
          'roasted_grams_needed', ROUND(bd.roasted_grams)::integer,
          'green_grams_needed', ROUND(bd.green_grams)::integer,
          'green_available', get_bean_available_stock(bd.bean_id)
        ))
        FROM bean_demand bd
      ), '[]'::jsonb)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_stock_summaries(
  p_user_id uuid,
  p_horizon_days integer DEFAULT 28
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN (
    SELECT COALESCE(
      jsonb_object_agg(
        b.id::text,
        get_bean_stock_summary(b.id, p_horizon_days)
      ),
      '{}'::jsonb
    )
    FROM beans b
    WHERE b.user_id = p_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_inventory_alerts(
  p_user_id uuid,
  p_horizon_days integer DEFAULT 28
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bean record;
  v_current integer;
  v_available integer;
  v_reserved integer;
  v_effective integer;
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  FOR v_bean IN
    SELECT id, low_stock_threshold_grams
    FROM beans
    WHERE user_id = p_user_id
  LOOP
    v_current := get_bean_current_stock(v_bean.id);
    v_available := get_bean_available_stock(v_bean.id);
    v_reserved := get_bean_reserved_stock(v_bean.id, p_horizon_days);
    v_effective := v_available - v_reserved;

    IF v_current > 0 AND v_effective >= 0 AND v_current > v_bean.low_stock_threshold_grams THEN
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id;
      CONTINUE;
    END IF;

    IF v_current <= 0 THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'out',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    END IF;

    IF v_effective < 0 THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'schedule',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    ELSE
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id AND reason = 'schedule';
    END IF;

    IF v_current > 0 AND v_current <= v_bean.low_stock_threshold_grams THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'low',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    ELSE
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id AND reason = 'low';
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_product_stock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_roasting_requirements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_stock_summaries(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_inventory_alerts(uuid, integer) TO authenticated;

-- ── 2a. Invite RPCs ─────────────────────────────────────────────────────────

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
  WHERE owner_id = v_uid;

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
  WHERE id = v_invite.org_id;

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

CREATE OR REPLACE FUNCTION public.remove_org_member(p_org_id uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM organizations
  WHERE id = p_org_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  -- cannot remove owner row via this path
  IF p_member_id = v_owner_id THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF v_uid <> v_owner_id AND v_uid <> p_member_id THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  DELETE FROM organization_members
  WHERE org_id = p_org_id AND user_id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_org_invite(text, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_org_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_org_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_org_invite(text, interval) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_org_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_org_member(uuid, uuid) TO authenticated;
