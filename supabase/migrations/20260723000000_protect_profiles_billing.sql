-- Block client self-escalation of billing fields on profiles.
-- RLS UPDATE only checks auth.uid() = id (no column restriction).
-- service_role / no-uid sessions (polar-webhook) may still set plan.

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
    NEW.plan := 'free';
    NEW.polar_customer_id := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: freeze billing fields for clients
  NEW.plan := OLD.plan;
  NEW.polar_customer_id := OLD.polar_customer_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profiles_billing ON public.profiles;
CREATE TRIGGER trg_protect_profiles_billing
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profiles_billing_columns();
