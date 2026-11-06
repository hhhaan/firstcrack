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

-- Inject faults inside the optional enqueue, never around the core save operation.
CREATE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type":"application/json"}'::jsonb,
  timeout_milliseconds integer DEFAULT 1000
) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'injected optional notification failure'
    USING ERRCODE = current_setting('test.notify_roast_fault');
END;
$$;

DO $$
DECLARE
  owner_id uuid;
  bean_id uuid;
  saved public.roast_sessions;
  fault text;
BEGIN
  SELECT id INTO STRICT owner_id FROM auth.users WHERE email = 'notify-roast-test@example.invalid';
  INSERT INTO public.beans(user_id, name) VALUES(owner_id, 'Notification fault fixture') RETURNING id INTO bean_id;
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type)
    VALUES(owner_id, bean_id, 10000, 'purchase');
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 57014 is query_canceled (the statement-timeout condition); P0004 is assert_failure.
  FOREACH fault IN ARRAY ARRAY['P0001', '57014', 'P0004'] LOOP
    PERFORM set_config('test.notify_roast_fault', fault, true);
    saved := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
      'status', 'completed', 'weight_grams', 1500, 'output_weight_grams', 1275,
      'bean_id', bean_id, 'batch_name', 'Protected', 'batch_title_numbering', 'total'),
      true, 1500, 1275, false);
    ASSERT EXISTS (SELECT 1 FROM public.roast_sessions
      WHERE id = saved.id AND status = 'completed' AND weight_grams = 1500
        AND batch_name = saved.batch_name AND total_batch_number IS NOT NULL),
      'notification fault must preserve the completed roast and allocated title';
    ASSERT (SELECT count(*) = 1 AND sum(delta_grams) = -1500
      FROM public.bean_stock_events WHERE reference_id = saved.id AND event_type = 'roast'),
      'notification fault must preserve green stock deduction';
    ASSERT EXISTS (SELECT 1 FROM public.roasted_stock_events
      WHERE reference_id = saved.id AND delta_grams = 1275 AND NOT is_estimate),
      'notification fault must preserve measured roasted inbound';
  END LOOP;
  RESET ROLE;
END;
$$;

DROP FUNCTION net.http_post(text, jsonb, jsonb, jsonb, integer);
ALTER FUNCTION net.notify_roast_test_http_post(text, jsonb, jsonb, jsonb, integer) RENAME TO http_post;

DO $$
DECLARE
  owner_id uuid;
  bean_id uuid;
  failed_id uuid := gen_random_uuid();
  queued bigint;
BEGIN
  SELECT id INTO STRICT owner_id FROM auth.users WHERE email = 'notify-roast-test@example.invalid';
  SELECT id INTO STRICT bean_id FROM public.beans WHERE user_id = owner_id AND name = 'Notification fault fixture';
  SELECT count(*) INTO queued FROM net.http_request_queue
    WHERE url = 'https://notify-roast.example.invalid/functions/v1/notify-roast';
  SET LOCAL ROLE authenticated;
  BEGIN
    -- This core validation runs after the INSERT (and its successful enqueue).
    PERFORM public.save_roast_op(jsonb_build_object('id', failed_id, 'user_id', owner_id,
      'status', 'completed', 'weight_grams', 1500, 'bean_id', bean_id,
      'batch_title_numbering', 'invalid'), true, 1500, 1275, false);
    RAISE EXCEPTION 'core validation failure was swallowed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.roast_sessions WHERE id = failed_id),
    'core save validation must still roll back the roast';
  ASSERT NOT EXISTS (SELECT 1 FROM public.bean_stock_events WHERE reference_id = failed_id);
  ASSERT NOT EXISTS (SELECT 1 FROM public.roasted_stock_events WHERE reference_id = failed_id);
  RESET ROLE;
  ASSERT (SELECT count(*) FROM net.http_request_queue
    WHERE url = 'https://notify-roast.example.invalid/functions/v1/notify-roast') = queued,
    'core save rollback must also remove its queued notification';
END;
$$;
ROLLBACK;
