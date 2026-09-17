-- Local seeded database only. Supply two existing writable profile UUIDs:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=... -v other_owner=... -f supabase/tests/save_roast_recovery.sql
-- Run as local postgres; this tests RPC contracts, not authenticated RLS policies.
BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('test.other_owner', :'other_owner', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);
DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  other_id uuid := current_setting('test.other_owner')::uuid;
  plan_id uuid;
  rule_id uuid;
  batch_id uuid;
  session_id uuid := gen_random_uuid();
  payload jsonb;
  conflicting_session_id uuid := gen_random_uuid();
  saved roast_sessions;
BEGIN
  INSERT INTO roast_day_plans(user_id, date) VALUES(owner_id, '2099-01-01')
    ON CONFLICT(user_id, date) DO UPDATE SET date = excluded.date RETURNING id INTO plan_id;
  INSERT INTO recurrence_rules(user_id, rrule, dtstart, bean_name, batch_size_kg, target_roasted_kg)
    VALUES(owner_id, 'FREQ=DAILY', '2099-01-01', 'test', 1, 0.8) RETURNING id INTO rule_id;
  INSERT INTO roast_plan_batches(plan_id, recurrence_rule_id, original_date, scheduled_date,
    bean_name, batch_size_kg, target_roasted_kg, exception_type)
    VALUES(plan_id, rule_id, '2099-01-01', '2099-01-01', 'test', 1, 0.8, 'modified') RETURNING id INTO batch_id;
  payload := jsonb_build_object('id', session_id, 'user_id', owner_id, 'plan_batch_id', batch_id,
    'weight_grams', 1000, 'roasted_at', now(), 'status', 'completed',
    'expected_plan_bean_id', NULL, 'expected_plan_blend_id', NULL);
  saved := save_roast_op(payload, false, 0, 0, false);
  ASSERT saved.id = session_id;
  saved := save_roast_op(payload, false, 0, 0, false);
  ASSERT (SELECT count(*) FROM roast_sessions WHERE id = session_id) = 1;
  ASSERT (SELECT count(*) FROM roast_sessions WHERE plan_batch_id = batch_id) = 1;

  -- Both expected null identities match this batch and preserve same-ID retries.
  saved := save_roast_op(payload || jsonb_build_object('expected_plan_bean_id', NULL,
    'expected_plan_blend_id', NULL), false, 0, 0, false);
  ASSERT saved.id = session_id;
  -- A saved session still returns even if its old expected inventory changed.
  saved := save_roast_op(payload || jsonb_build_object('expected_plan_bean_id', gen_random_uuid()), false, 0, 0, false);
  ASSERT saved.id = session_id;
  BEGIN
    PERFORM save_roast_op(payload || jsonb_build_object('id', conflicting_session_id,
      'expected_plan_bean_id', gen_random_uuid(), 'expected_plan_blend_id', NULL), true, 1000, 800, false);
    RAISE EXCEPTION 'test: changed bean accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'plan batch bean or blend changed; confirm actual roast inventory' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM save_roast_op(payload || jsonb_build_object('id', conflicting_session_id,
      'expected_plan_bean_id', NULL, 'expected_plan_blend_id', gen_random_uuid()), true, 1000, 800, false);
    RAISE EXCEPTION 'test: changed blend accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'plan batch bean or blend changed; confirm actual roast inventory' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM roast_sessions WHERE id = conflicting_session_id);
  ASSERT NOT EXISTS (SELECT 1 FROM bean_stock_events WHERE reference_id = conflicting_session_id);

  UPDATE recurrence_rules SET status = 'cancelled' WHERE id = rule_id;
  saved := save_roast_op(payload, false, 0, 0, false);
  ASSERT saved.id = session_id, 'existing commit must survive later cancellation';
  BEGIN
    PERFORM save_roast_op(payload || jsonb_build_object('id', gen_random_uuid()), false, 0, 0, false);
    RAISE EXCEPTION 'test: cancelled rule accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'plan recurrence cancelled or ended' THEN RAISE; END IF;
  END;

  UPDATE recurrence_rules SET status = 'active', "until" = '2098-12-31' WHERE id = rule_id;
  BEGIN
    PERFORM save_roast_op(payload || jsonb_build_object('id', gen_random_uuid()), false, 0, 0, false);
    RAISE EXCEPTION 'test: ended rule accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'plan recurrence cancelled or ended' THEN RAISE; END IF;
  END;

  UPDATE recurrence_rules SET "until" = NULL WHERE id = rule_id;
  UPDATE roast_plan_batches SET exception_type = 'cancelled' WHERE id = batch_id;
  BEGIN
    PERFORM save_roast_op(payload || jsonb_build_object('id', gen_random_uuid()), false, 0, 0, false);
    RAISE EXCEPTION 'test: cancelled exception accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'plan batch cancelled' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', other_id::text, true);
  BEGIN
    PERFORM save_roast_op(payload || jsonb_build_object('user_id', other_id), false, 0, 0, false);
    RAISE EXCEPTION 'test: foreign owner existing session accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'session owner mismatch' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM save_roast_op(payload || jsonb_build_object('id', gen_random_uuid(), 'user_id', other_id), false, 0, 0, false);
    RAISE EXCEPTION 'test: foreign owner batch accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'plan batch owner mismatch' THEN RAISE; END IF;
  END;
END;
$$;
ROLLBACK;
