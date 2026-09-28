-- Committed fixture for contract runs. Not a migration.
-- Caller passes -v owner= and -v other_owner= (uuid text).
-- Runs as supabase_admin (owns auth.users). postgres cannot DISABLE TRIGGER there.
--
-- Disables user triggers on auth.users first. on_auth_user_created_slack
-- POSTs to the hosted notify-signup function; this seed must not do that.

ALTER TABLE auth.users DISABLE TRIGGER USER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    UPDATE cron.job SET active = false;
  END IF;
END $$;

-- Column set is the Postgres image's auth.users (gotrue migrate is not run).
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    :'owner'::uuid,
    'authenticated',
    'authenticated',
    'contract-owner@example.com',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    :'other_owner'::uuid,
    'authenticated',
    'authenticated',
    'contract-other@example.com',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

-- auth.uid() is null here, so protect_profiles_billing leaves plan as inserted.
INSERT INTO public.profiles (id, plan)
VALUES
  (:'owner'::uuid, 'pro'),
  (:'other_owner'::uuid, 'pro');
