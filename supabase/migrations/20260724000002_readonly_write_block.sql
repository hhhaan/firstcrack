-- read_only / expired-trial write block on money·inventory·batch tables.
-- Owner = row user_id (workspace members write into the owner's workspace, so the
-- owner's plan gates). Reuses profile_write_error(); client UI is UX-only mirror.
-- v1 scope: profile/settings display fields stay writable; DELETE stays allowed (data ownership).

CREATE OR REPLACE FUNCTION public.enforce_profile_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  gate_err text;
BEGIN
  v_user := COALESCE(NEW.user_id, OLD.user_id);
  gate_err := public.profile_write_error(v_user);
  IF gate_err IS NOT NULL THEN
    RAISE EXCEPTION '%', gate_err
      USING ERRCODE = 'check_violation',
            DETAIL = format('table=%s user=%s', TG_TABLE_NAME, v_user);
  END IF;
  RETURN NEW;
END;
$$;

-- roast_plan_batches has no user_id — resolve owner through the parent day plan.
CREATE OR REPLACE FUNCTION public.enforce_profile_writable_plan_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  gate_err text;
BEGIN
  SELECT user_id INTO v_user FROM public.roast_day_plans
  WHERE id = COALESCE(NEW.plan_id, OLD.plan_id);

  gate_err := public.profile_write_error(v_user);
  IF gate_err IS NOT NULL THEN
    RAISE EXCEPTION '%', gate_err
      USING ERRCODE = 'check_violation',
            DETAIL = format('table=%s user=%s', TG_TABLE_NAME, v_user);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'roast_sessions',
    'bean_stock_events',
    'roasted_stock_events',
    'product_stock_events',
    'roast_day_plans',
    'beans',
    'blends'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_readonly_write_block ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_readonly_write_block BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_writable()',
      t
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_readonly_write_block ON public.roast_plan_batches;
CREATE TRIGGER trg_readonly_write_block
  BEFORE INSERT OR UPDATE ON public.roast_plan_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_writable_plan_batch();
