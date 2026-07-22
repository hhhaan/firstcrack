-- Notify Slack (#general) on new auth.users signup via Edge Function + pg_net

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_signup_slack()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  BEGIN
    -- Only the fields notify-signup needs — never full auth.users (encrypted_password, tokens, …).
    PERFORM net.http_post(
      url := 'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/notify-signup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'record', jsonb_build_object(
          'id', NEW.id,
          'email', NEW.email,
          'created_at', NEW.created_at,
          'raw_user_meta_data', NEW.raw_user_meta_data
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block signups if Slack enqueue fails.
    RAISE WARNING 'notify_signup_slack failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_slack ON auth.users;

CREATE TRIGGER on_auth_user_created_slack
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_signup_slack();

REVOKE ALL ON FUNCTION public.notify_signup_slack() FROM PUBLIC;
