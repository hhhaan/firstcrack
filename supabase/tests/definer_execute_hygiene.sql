-- Local database only. Validates definer execute hygiene (inventory cron, plan gate RPC, signup secret).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  plan_id uuid;
  batch_id uuid;
  run_id uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (owner_id, 'definer-hygiene@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;
  INSERT INTO public.beans(id, user_id, name) VALUES (gen_random_uuid(), owner_id, 'Cron bean');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  run_id := public.compute_inventory_alerts_for_all_users(28);
  ASSERT run_id IS NOT NULL, 'cron-style all-users compute should succeed without session auth';
  ASSERT EXISTS (
    SELECT 1 FROM public.inventory_alert_runs WHERE id = run_id AND status = 'success'
  ), 'cron path should finish the run log';

  ASSERT NOT has_function_privilege('anon', 'public.compute_inventory_alerts_for_all_users(integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('PUBLIC', 'public.compute_inventory_alerts_for_all_users(integer)', 'EXECUTE');

  ASSERT NOT has_function_privilege('anon', 'public.profile_write_error(uuid)', 'EXECUTE');

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.profile_write_error(owner_id);
    RAISE EXCEPTION 'direct profile_write_error RPC accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.roast_day_plans(user_id, date)
    VALUES (owner_id, CURRENT_DATE) RETURNING id INTO plan_id;
  INSERT INTO public.roast_plan_batches(plan_id, bean_name, batch_size_kg, target_roasted_kg, order_index)
    VALUES (plan_id, 'Gate', 1, 0.8, 1) RETURNING id INTO batch_id;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.profiles SET plan = 'read_only' WHERE id = owner_id;

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.reorder_plan_batches(plan_id, ARRAY[batch_id]);
    RAISE EXCEPTION 'readonly trigger bypass accepted';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM = 'read_only_plan';
  END;
END;
$$;

DELETE FROM vault.secrets WHERE name = 'notify_signup_secret';
SELECT vault.create_secret('local-signup-secret', 'notify_signup_secret');

DO $$
DECLARE
  signup_id uuid := gen_random_uuid();
  queued bigint;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (signup_id, 'signup-secret@example.invalid');
  SELECT count(*) INTO queued
  FROM net.http_request_queue
  WHERE url = 'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/notify-signup';
  ASSERT queued = 1, 'signup should enqueue once when Vault secret is configured';
  ASSERT EXISTS (
    SELECT 1 FROM net.http_request_queue
    WHERE url = 'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/notify-signup'
      AND headers->>'x-webhook-secret' = 'local-signup-secret'
      AND (convert_from(body, 'UTF8')::jsonb -> 'record' ->> 'email') = 'signup-secret@example.invalid'
  ), 'signup enqueue must carry notify_signup_secret';
END;
$$;

ROLLBACK;
