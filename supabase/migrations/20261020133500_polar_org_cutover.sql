-- skip-grant-check: Billing ingestion tables and RPC are service_role only.
CREATE TABLE public.billing_customers (
  polar_organization_id uuid NOT NULL,
  polar_customer_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  PRIMARY KEY (polar_organization_id, polar_customer_id),
  UNIQUE (polar_organization_id, user_id)
);
CREATE TABLE public.polar_subscription_state (
  polar_organization_id uuid NOT NULL,
  polar_subscription_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  polar_customer_id text,
  plan text CHECK (plan IN ('pro','pro_plus','enterprise')),
  payload jsonb NOT NULL,
  event_at timestamptz NOT NULL,
  PRIMARY KEY (polar_organization_id, polar_subscription_id)
);
CREATE TABLE public.polar_webhook_events (
  polar_organization_id uuid NOT NULL,
  event_id text NOT NULL,
  event_at timestamptz NOT NULL,
  PRIMARY KEY (polar_organization_id, event_id)
);
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polar_subscription_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polar_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_customers, public.polar_subscription_state, public.polar_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_customers, public.polar_subscription_state, public.polar_webhook_events TO service_role;
-- Bootstrap existing paid subscriptions so a different organization's cancellation cannot remove them.
INSERT INTO public.polar_subscription_state
SELECT DISTINCT ON (s.user_id) 'f0ef6666-e89c-4a50-8808-78ff4b4d3a1d', s.polar_subscription_id, s.user_id,
       p.polar_customer_id,
       CASE WHEN p.plan IN ('pro','pro_plus','enterprise') THEN p.plan ELSE NULL END,
       jsonb_build_object('id',s.polar_subscription_id,'status',s.status,
         'current_period_end',s.current_period_end,'cancel_at_period_end',s.cancel_at_period_end),
       '-infinity'::timestamptz
FROM public.subscriptions s JOIN public.profiles p ON p.id=s.user_id
WHERE s.polar_subscription_id IS NOT NULL
  AND p.plan IN ('pro','pro_plus','enterprise')
  AND (s.ends_at IS NULL OR s.ends_at > now())
  AND (s.status IN ('active','trialing') OR (s.status='canceled' AND s.cancel_at_period_end IS TRUE AND s.current_period_end > now()))
ORDER BY s.user_id,s.current_period_start DESC NULLS LAST,s.updated_at DESC,s.polar_subscription_id;
INSERT INTO public.billing_customers
SELECT 'f0ef6666-e89c-4a50-8808-78ff4b4d3a1d', polar_customer_id, id FROM public.profiles
WHERE polar_customer_id IS NOT NULL;

CREATE FUNCTION public.apply_polar_subscription_event(
  p_org_id uuid, p_event_id text, p_event_at timestamptz, p_user_id uuid,
  p_customer_id text, p_subscription jsonb, p_plan text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid; v_existing public.polar_subscription_state; v_plan text; v_customer text;
BEGIN
  IF p_org_id NOT IN ('f0ef6666-e89c-4a50-8808-78ff4b4d3a1d'::uuid,'3b6494cb-8248-47d1-a5f2-65ff7ca9b8a8'::uuid)
     OR p_event_id IS NULL OR p_event_id = '' OR p_event_at IS NULL
     OR coalesce(p_subscription->>'id','') = '' OR coalesce(p_customer_id,'') = ''
     OR coalesce(p_subscription->>'status','') = ''
     OR (p_plan IS NOT NULL AND p_plan NOT IN ('pro','pro_plus','enterprise')) THEN
    RAISE EXCEPTION 'Invalid Polar event';
  END IF;
  SELECT user_id INTO v_user FROM public.billing_customers
    WHERE polar_organization_id=p_org_id AND polar_customer_id=p_customer_id;
  IF v_user IS NOT NULL AND p_user_id IS NOT NULL AND v_user <> p_user_id THEN
    RAISE EXCEPTION 'Polar identity mismatch';
  END IF;
  v_user := coalesce(v_user,p_user_id);
  IF v_user IS NULL THEN RAISE EXCEPTION 'Unresolved Polar user'; END IF;
  -- Serialize ALL subscriptions/orgs for this account before recomputing its plan.
  PERFORM 1 FROM public.profiles WHERE id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown Polar user'; END IF;
  INSERT INTO public.polar_webhook_events VALUES(p_org_id,p_event_id,p_event_at) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;
  SELECT * INTO v_existing FROM public.polar_subscription_state
    WHERE polar_organization_id=p_org_id AND polar_subscription_id=p_subscription->>'id';
  IF FOUND THEN
    IF v_existing.user_id <> v_user THEN RAISE EXCEPTION 'Subscription identity mismatch'; END IF;
    -- A terminal revoke wins equal timestamps. Other equal-time updates cannot resurrect it.
    IF v_existing.event_at > p_event_at OR (v_existing.event_at = p_event_at AND
       (v_existing.payload->>'status' IN ('revoked','ended') OR p_subscription->>'status' NOT IN ('revoked','ended'))) THEN
      RETURN 'stale';
    END IF;
  END IF;
  INSERT INTO public.billing_customers VALUES(p_org_id,p_customer_id,v_user)
    ON CONFLICT (polar_organization_id,polar_customer_id) DO NOTHING;
  -- A different account can win a concurrent insert while this profile is locked.
  -- Re-read after conflict resolution; never entitle the losing identity.
  IF NOT EXISTS (SELECT 1 FROM public.billing_customers
    WHERE polar_organization_id=p_org_id AND polar_customer_id=p_customer_id AND user_id=v_user) THEN
    RAISE EXCEPTION 'Polar customer mapping identity conflict';
  END IF;
  INSERT INTO public.polar_subscription_state VALUES(p_org_id,p_subscription->>'id',v_user,p_customer_id,p_plan,p_subscription,p_event_at)
    ON CONFLICT (polar_organization_id,polar_subscription_id) DO UPDATE SET
      payload=excluded.payload, event_at=excluded.event_at, plan=excluded.plan, polar_customer_id=excluded.polar_customer_id;
  -- Compatibility projection for desktop readers. Polar UUIDs are globally unique.
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE polar_subscription_id=p_subscription->>'id' AND user_id<>v_user) THEN
    RAISE EXCEPTION 'Subscription projection identity mismatch';
  END IF;
  INSERT INTO public.subscriptions(user_id,polar_subscription_id,status,current_period_start,current_period_end,
    cancel_at_period_end,canceled_at,ends_at,polar_product_id,amount,currency,recurring_interval,trial_end)
  VALUES(v_user,p_subscription->>'id',CASE WHEN p_subscription->>'status' IN ('revoked','ended') THEN 'canceled' ELSE p_subscription->>'status' END,
    (p_subscription->>'current_period_start')::timestamptz,(p_subscription->>'current_period_end')::timestamptz,
    coalesce((p_subscription->>'cancel_at_period_end')::boolean,false),(p_subscription->>'canceled_at')::timestamptz,
    (p_subscription->>'ended_at')::timestamptz,p_subscription->>'product_id',
    (p_subscription->>'amount')::integer,p_subscription->>'currency',p_subscription->>'recurring_interval',(p_subscription->>'trial_end')::timestamptz)
  ON CONFLICT (polar_subscription_id) DO UPDATE SET
    status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,canceled_at=excluded.canceled_at,ends_at=excluded.ends_at,
    polar_product_id=excluded.polar_product_id,amount=excluded.amount,currency=excluded.currency,
    recurring_interval=excluded.recurring_interval,trial_end=excluded.trial_end,updated_at=now();
  SELECT plan,polar_customer_id INTO v_plan,v_customer FROM public.polar_subscription_state
  WHERE user_id=v_user AND plan IS NOT NULL AND (
    (payload->>'status' IN ('active','trialing') AND
      ((payload->>'current_period_end') IS NULL OR (payload->>'current_period_end')::timestamptz > now()))
    OR (payload->>'status' = 'canceled' AND (payload->>'current_period_end')::timestamptz > now())
  ) ORDER BY CASE plan WHEN 'enterprise' THEN 3 WHEN 'pro_plus' THEN 2 ELSE 1 END DESC,
    event_at DESC,polar_organization_id DESC LIMIT 1;
  UPDATE public.profiles SET plan=CASE
    WHEN plan IN ('tester','team') THEN plan
    WHEN v_plan IS NOT NULL THEN v_plan
    WHEN plan IN ('pro','pro_plus','enterprise','read_only') THEN 'read_only'
    ELSE plan END,
    polar_customer_id=coalesce(v_customer,polar_customer_id) WHERE id=v_user;
  RETURN 'applied';
END;
$$;
REVOKE ALL ON FUNCTION public.apply_polar_subscription_event(uuid,text,timestamptz,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_polar_subscription_event(uuid,text,timestamptz,uuid,text,jsonb,text) TO service_role;

-- Shared by Edge and landing: semantic event keys, not endpoint-specific webhook IDs.
CREATE TABLE public.polar_notification_outbox (
  polar_organization_id uuid NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL,
  lease_id uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  PRIMARY KEY (polar_organization_id,event_id)
);
ALTER TABLE public.polar_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.polar_notification_outbox FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.polar_notification_outbox TO service_role;

CREATE FUNCTION public.claim_polar_notification(p_org_id uuid,p_event_id text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_row public.polar_notification_outbox; v_lease uuid;
BEGIN
  IF p_org_id IS NULL OR p_org_id NOT IN ('f0ef6666-e89c-4a50-8808-78ff4b4d3a1d'::uuid,'3b6494cb-8248-47d1-a5f2-65ff7ca9b8a8'::uuid)
     OR p_event_id IS NULL OR p_event_id !~ '^(subscription[.]created|order[.]paid):.+'
     OR p_payload IS NULL OR jsonb_typeof(p_payload->'text') IS DISTINCT FROM 'string'
     OR length(p_payload->>'text')=0 THEN
    RAISE EXCEPTION 'Invalid Polar notification';
  END IF;
  INSERT INTO public.polar_notification_outbox(polar_organization_id,event_id,payload)
    VALUES(p_org_id,p_event_id,p_payload) ON CONFLICT DO NOTHING;
  SELECT * INTO v_row FROM public.polar_notification_outbox
    WHERE polar_organization_id=p_org_id AND event_id=p_event_id FOR UPDATE;
  IF v_row.sent_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','sent','lease_id',NULL,'payload',v_row.payload);
  END IF;
  IF v_row.lease_until > clock_timestamp() THEN
    RETURN jsonb_build_object('status','busy','lease_id',NULL,'payload',v_row.payload);
  END IF;
  v_lease:=gen_random_uuid();
  UPDATE public.polar_notification_outbox SET lease_id=v_lease,
    lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1
    WHERE polar_organization_id=p_org_id AND event_id=p_event_id;
  RETURN jsonb_build_object('status','claimed','lease_id',v_lease,'payload',v_row.payload);
END;
$$;

CREATE FUNCTION public.finish_polar_notification(p_org_id uuid,p_event_id text,p_lease_id uuid,p_sent boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_sent IS NULL OR p_lease_id IS NULL THEN RETURN false; END IF;
  UPDATE public.polar_notification_outbox SET
    sent_at=CASE WHEN p_sent THEN clock_timestamp() ELSE NULL END,
    lease_id=NULL,lease_until=NULL
    WHERE polar_organization_id=p_org_id AND event_id=p_event_id
      AND lease_id=p_lease_id AND lease_until>clock_timestamp() AND sent_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_polar_notification(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_polar_notification(uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_polar_notification(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_polar_notification(uuid,text,uuid,boolean) TO service_role;
