-- Internal `tester` plan: entitlements identical to pro_plus (unlimited batches/machines,
-- no order integration, no team). Never sold — set by hand, not by the Polar webhook.
-- Cap anchors below are parsed by scripts/check-plan-caps.mjs; keep the shapes intact.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan = ANY (ARRAY['trial'::text, 'read_only'::text, 'free'::text, 'pro'::text, 'pro_plus'::text, 'tester'::text, 'team'::text, 'enterprise'::text]));

CREATE OR REPLACE FUNCTION public.enforce_batch_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gate_err text;
  owner_plan text;
  used int;
  cap int := 200;
  month_start timestamptz;
  month_end timestamptz;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  -- Already completed: editing other fields must not re-count against caps.
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  gate_err := public.profile_write_error(NEW.user_id);
  IF gate_err IS NOT NULL THEN
    RAISE EXCEPTION '%', gate_err
      USING ERRCODE = 'check_violation',
            DETAIL = format('user=%s', NEW.user_id);
  END IF;

  SELECT plan INTO owner_plan FROM public.profiles WHERE id = NEW.user_id;
  -- trial is gated by the lifetime cap above; unlimited tiers pass.
  IF owner_plan IN ('trial', 'pro_plus', 'tester', 'enterprise', 'team') THEN
    RETURN NEW;
  END IF;

  -- pro / legacy free / unknown: 200 completed sessions per UTC month.
  month_start := date_trunc('month', timezone('utc', now()));
  month_end := month_start + interval '1 month';

  SELECT count(*)::int INTO used
  FROM public.roast_sessions
  WHERE user_id = NEW.user_id
    AND status = 'completed'
    AND roasted_at >= month_start
    AND roasted_at < month_end
    AND (TG_OP = 'INSERT' OR id IS DISTINCT FROM NEW.id);

  IF used >= cap THEN
    RAISE EXCEPTION 'monthly_batch_cap_exceeded'
      USING ERRCODE = 'check_violation',
            DETAIL = format('used=%s cap=%s plan=%s', used, cap, coalesce(owner_plan, 'null'));
  END IF;

  RETURN NEW;
END;
$$;
