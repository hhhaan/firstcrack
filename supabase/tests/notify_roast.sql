-- Local database only. No requests escape: all pg_net queue entries roll back.
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_slack;
DELETE FROM vault.secrets WHERE name IN ('notify_roast_secret', 'notify_roast_url');
SELECT vault.create_secret('local-test-secret', 'notify_roast_secret');
SELECT vault.create_secret('https://notify-roast.example.invalid/functions/v1/notify-roast', 'notify_roast_url');

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  saved public.roast_sessions;
  retried public.roast_sessions;
  queued bigint;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.notify_roast_slack()', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.notify_roast_slack()', 'EXECUTE');
  INSERT INTO auth.users(id, email) VALUES(owner_id, 'notify-roast-test@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  saved := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 1500, 'batch_name', 'Batch', 'batch_title_numbering', 'total'),
    false, 0, 0, false);
  retried := public.save_roast_op(jsonb_build_object('id', saved.id, 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 1500), false, 0, 0, false);
  UPDATE public.roast_sessions SET batch_name = 'Renamed', status = 'completed' WHERE id = saved.id;
  RESET ROLE;

  SELECT count(*) INTO queued FROM net.http_request_queue WHERE url = 'https://notify-roast.example.invalid/functions/v1/notify-roast';
  ASSERT queued = 1, 'a successful save enqueues once; retries and history edits do not';
  ASSERT EXISTS (SELECT 1 FROM net.http_request_queue
    WHERE url = 'https://notify-roast.example.invalid/functions/v1/notify-roast'
      AND headers->>'x-webhook-secret' = 'local-test-secret'
      AND convert_from(body, 'UTF8')::jsonb = jsonb_build_object('session_id', saved.id)),
    'enqueue carries the shared secret and only the immutable session id';
  ASSERT retried.id = saved.id;

  INSERT INTO public.roast_sessions(user_id, status, weight_grams)
    VALUES(owner_id, 'in_progress', 0) RETURNING * INTO saved;
  ASSERT (SELECT count(*) FROM net.http_request_queue WHERE url = 'https://notify-roast.example.invalid/functions/v1/notify-roast') = 1;
  UPDATE public.roast_sessions SET status = 'completed' WHERE id = saved.id;
  ASSERT (SELECT count(*) FROM net.http_request_queue WHERE url = 'https://notify-roast.example.invalid/functions/v1/notify-roast') = 2,
    'transition to completed notifies';

  BEGIN
    INSERT INTO public.roast_sessions(user_id, status, weight_grams) VALUES(owner_id, 'completed', 0);
    RAISE EXCEPTION 'rollback fixture';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM net.http_request_queue WHERE url = 'https://notify-roast.example.invalid/functions/v1/notify-roast') = 2,
    'rolled back saves do not enqueue';

  DELETE FROM vault.secrets WHERE name = 'notify_roast_secret';
  INSERT INTO public.roast_sessions(user_id, status, weight_grams) VALUES(owner_id, 'completed', 0);
  ASSERT (SELECT count(*) FROM net.http_request_queue WHERE url = 'https://notify-roast.example.invalid/functions/v1/notify-roast') = 2,
    'missing secrets do not block saves or enqueue unauthenticated requests';
END;
$$;

SELECT vault.create_secret('local-test-secret', 'notify_roast_secret');
ALTER FUNCTION net.http_post(text, jsonb, jsonb, jsonb, integer) RENAME TO notify_roast_test_http_post;
INSERT INTO public.roast_sessions(user_id, status, weight_grams)
  SELECT id, 'completed', 0 FROM public.profiles WHERE id IN
    (SELECT id FROM auth.users WHERE email = 'notify-roast-test@example.invalid');
-- The insert succeeds while the enqueue function is unavailable.
ROLLBACK;
