-- Server-side monthly completed-batch cap (mirrors plan-matrix.ts PRO_MONTHLY_BATCH_CAP=200).
-- Unlimited: pro_plus | enterprise | team. free/pro/unknown: 200 completed sessions / UTC month.
-- Client still checks for UX; this is the hard gate against API bypass.
-- UTC month is the source of truth (client may use local calendar — boundary skew accepted).

CREATE OR REPLACE FUNCTION public.enforce_monthly_batch_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_plan text;
  used int;
  cap int := 200;
  month_start timestamptz;
  month_end timestamptz;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  -- Already completed: editing other fields must not re-count against cap.
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT plan INTO owner_plan FROM public.profiles WHERE id = NEW.user_id;
  IF owner_plan IN ('pro_plus', 'enterprise', 'team') THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_enforce_monthly_batch_cap ON public.roast_sessions;
CREATE TRIGGER trg_enforce_monthly_batch_cap
  BEFORE INSERT OR UPDATE OF status ON public.roast_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_monthly_batch_cap();
