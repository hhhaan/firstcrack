-- Local database only. Everything runs in one transaction and rolls back.
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=<writable profile uuid> -f supabase/tests/roast_record_edit.sql
-- Calls the RPC as `authenticated` so workspace RLS and the readonly write gate apply.
BEGIN;
SELECT set_config('test.owner', :'owner', true);
DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  stranger uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  profile_id uuid;
  old_events jsonb := '[{"id":"c","type":"Charge","time_sec":0,"temp_c":200.4},{"id":"u","type":"Mystery","time_sec":30,"extra":1},{"id":"f","type":"FC Start","time_sec":480,"temp_c":196},{"id":"d","type":"Drop","time_sec":600,"temp_c":210}]';
  new_events jsonb := '[{"id":"c","type":"Charge","time_sec":0,"temp_c":201},{"id":"u","type":"Mystery","time_sec":30,"extra":1},{"id":"f","type":"FC Start","time_sec":470,"temp_c":195},{"id":"d","type":"Drop","time_sec":610,"temp_c":212}]';
  heater jsonb := '[{"t":0,"bt":200,"heater":70},{"t":120,"bt":150,"heater":55}]';
  saved roast_sessions;
  stock_before bigint;
  stock_after bigint;
  prof roast_profiles;
BEGIN
  UPDATE profiles SET plan = 'team' WHERE id = owner_id;
  INSERT INTO roast_sessions(id, user_id, weight_grams, status, roasted_at, duration_seconds, drop_temp_celsius, events)
    VALUES(session_id, owner_id, 1000, 'completed', now(), 640, 210, old_events);
  INSERT INTO roast_profiles(user_id, name, target_level, source_session_id, drop_temp_celsius, duration_sec)
    VALUES(owner_id, 'p623', 'Medium', session_id, 210, 600) RETURNING id INTO profile_id;
  SELECT (SELECT count(*) FROM bean_stock_events) + (SELECT count(*) FROM roasted_stock_events) INTO stock_before;

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  saved := update_roast_session_record(session_id, old_events, NULL, new_events, heater, 212, 640,
    '{"charge_temp_celsius":201,"drop_temp_celsius":212,"duration_sec":610,"dev_time_sec":140,"dev_pct":23}');
  ASSERT saved.events = new_events, 'events saved';
  ASSERT saved.heater_events = heater, 'heater saved';
  ASSERT saved.drop_temp_celsius = 212, 'drop summary saved';

  -- stale expected events → conflict, nothing written
  BEGIN
    PERFORM update_roast_session_record(session_id, old_events, NULL, new_events, NULL, 212, 640, NULL);
    RAISE EXCEPTION 'conflict not raised';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;

  -- dropping/adding/renaming events is rejected
  BEGIN
    PERFORM update_roast_session_record(session_id, new_events, heater, new_events - 1, heater, 212, 640, NULL);
    RAISE EXCEPTION 'delete not rejected';
  EXCEPTION WHEN SQLSTATE 'PT422' THEN NULL;
  END;
  BEGIN
    PERFORM update_roast_session_record(session_id, new_events, heater,
      jsonb_set(new_events, '{1,extra}', '2'), heater, 212, 640, NULL);
    RAISE EXCEPTION 'unknown field change not rejected';
  EXCEPTION WHEN SQLSTATE 'PT422' THEN NULL;
  END;
  BEGIN
    PERFORM update_roast_session_record(session_id, new_events, heater,
      jsonb_set(new_events, '{2,time_sec}', '-1'), heater, 212, 640, NULL);
    RAISE EXCEPTION 'negative time not rejected';
  EXCEPTION WHEN SQLSTATE 'PT422' THEN NULL;
  END;

  -- reset heater to recorded TSV
  saved := update_roast_session_record(session_id, new_events, heater, new_events, NULL, 212, 640, NULL);
  ASSERT saved.heater_events IS NULL, 'heater reset';

  -- another account cannot see the row
  PERFORM set_config('request.jwt.claim.sub', stranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM update_roast_session_record(session_id, new_events, NULL, new_events, heater, 212, 640, NULL);
    RAISE EXCEPTION 'foreign workspace not rejected';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;

  -- read-only workspace plan blocks the write
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE profiles SET plan = 'read_only' WHERE id = owner_id;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM update_roast_session_record(session_id, new_events, NULL, new_events, heater, 212, 640, NULL);
    RAISE EXCEPTION 'read_only not rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RESET ROLE;
  SELECT * INTO prof FROM roast_profiles WHERE id = profile_id;
  ASSERT prof.duration_sec = 610 AND prof.dev_time_sec = 140 AND prof.charge_temp_celsius = 201, 'profile summary synced';
  SELECT (SELECT count(*) FROM bean_stock_events) + (SELECT count(*) FROM roasted_stock_events) INTO stock_after;
  ASSERT stock_after = stock_before, 'no inventory side effects';
  RAISE NOTICE 'roast_record_edit: ok';
END $$;
ROLLBACK;
