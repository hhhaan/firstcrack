-- One asynchronous notification per committed completed roast. No client schema changes.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_roast_slack()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'notify_roast_secret';
    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'notify_roast_url';
    IF NULLIF(v_secret, '') IS NULL OR NULLIF(v_url, '') IS NULL THEN
      RAISE WARNING 'notify_roast_slack skipped: Vault configuration missing';
      RETURN NEW;
    END IF;

    -- pg_net sends after commit; the handler reads the final numbered title.
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      body := jsonb_build_object('session_id', NEW.id),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
    -- OTHERS excludes cancellation/assertion; only optional notification work may fail open.
    RAISE WARNING 'notify_roast_slack enqueue failed (%)', SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_roast_slack() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_roast_completed_slack
  AFTER INSERT OR UPDATE OF status ON public.roast_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_roast_slack();
