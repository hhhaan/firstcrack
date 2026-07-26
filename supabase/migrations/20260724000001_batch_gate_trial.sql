-- Unified batch gate: read_only / trial(14d, 20 lifetime) / pro 200-month in one trigger.
-- Trial end is DERIVED per write, not flipped onto profiles.plan — a BEFORE trigger
-- cannot persist the flip and RAISE in the same transaction (the RAISE rolls it back).
-- read_only rows come only from the cancel webhook / backfill.
-- profile_write_error() is shared with the read_only write-block triggers.
-- Cap values below are anchors parsed by scripts/check-plan-caps.mjs (parity with plan-matrix.ts):
--   the trial interval 'N days', the completed-count >= N trial cap, and cap int := N.
--   Changing the shape of those expressions (not just the number) requires updating that script.

CREATE OR REPLACE FUNCTION public.profile_write_error(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_created timestamptz;
BEGIN
  SELECT plan, created_at INTO v_plan, v_created
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_plan = 'read_only' THEN
    RETURN 'read_only_plan';
  END IF;

  IF v_plan = 'trial' THEN
    IF now() > v_created + interval '14 days' THEN
      RETURN 'trial_expired';
    END IF;
    -- ponytail: count per write; cache a flag on profiles if this ever hurts
    IF (SELECT count(*) FROM public.roast_sessions
        WHERE user_id = p_user_id AND status = 'completed') >= 20 THEN
      RETURN 'trial_batch_cap';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_monthly_batch_cap ON public.roast_sessions;
DROP FUNCTION IF EXISTS public.enforce_monthly_batch_cap();

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
  IF owner_plan IN ('trial', 'pro_plus', 'enterprise', 'team') THEN
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

CREATE TRIGGER trg_enforce_batch_gate
  BEFORE INSERT OR UPDATE OF status ON public.roast_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_batch_gate();
