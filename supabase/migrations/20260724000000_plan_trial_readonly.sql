-- Plan lifecycle: signup → trial → (pay) pro/pro_plus → (cancel/caps) read_only.
-- SSOT: docs/pricing/01-plan-tiers.md, 06-enforcement-map.md
-- trial/read_only join the CHECK; signup default becomes trial; legacy free rows backfilled.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan = ANY (ARRAY['trial'::text, 'read_only'::text, 'free'::text, 'pro'::text, 'pro_plus'::text, 'team'::text, 'enterprise'::text]));

-- handle_new_user inserts without plan — this column default is the signup source of truth.
ALTER TABLE public.profiles ALTER COLUMN plan SET DEFAULT 'trial';

-- Client INSERT pins plan to trial (was free); UPDATE freeze unchanged.
CREATE OR REPLACE FUNCTION public.protect_profiles_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Authenticated clients have auth.uid(); service_role webhook typically has none.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.plan := 'trial';
    NEW.polar_customer_id := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: freeze billing fields for clients
  NEW.plan := OLD.plan;
  NEW.polar_customer_id := OLD.polar_customer_id;
  RETURN NEW;
END;
$$;

-- Backfill legacy free: inside the 14-day window and under the 20 lifetime completed
-- batches → trial, else read_only. Paid plans untouched.
UPDATE public.profiles p
SET plan = CASE
  WHEN p.created_at > now() - interval '14 days'
   AND (SELECT count(*) FROM public.roast_sessions rs
        WHERE rs.user_id = p.id AND rs.status = 'completed') < 20
  THEN 'trial'
  ELSE 'read_only'
END
WHERE p.plan = 'free';
