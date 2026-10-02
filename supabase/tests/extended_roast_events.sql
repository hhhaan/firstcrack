-- Local database only; rollback after testing the predefined event extension.
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=<writable profile uuid> -f supabase/tests/extended_roast_events.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);
DO $$
DECLARE
  sid uuid := gen_random_uuid();
  original jsonb := '[{"id":"c","type":"Charge","time_sec":0},{"id":"y","type":"Yellow","time_sec":180},{"id":"f","type":"FC Start","time_sec":480},{"id":"d","type":"Drop","time_sec":600},{"id":"u","type":"Mystery","time_sec":700,"extra":1}]';
  extended jsonb;
  edited jsonb;
  candidate jsonb;
  saved public.roast_sessions;
  kind text;
BEGIN
  INSERT INTO public.roast_sessions(id, user_id, weight_grams, status, roasted_at, events)
  VALUES(sid, current_setting('test.owner')::uuid, 1000, 'completed', now(), original);
  PERFORM set_config('request.jwt.claim.sub', current_setting('test.owner'), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  extended := original || '[{"id":"cc","type":"Color Change","time_sec":300,"temp_c":175},{"id":"sc","type":"SC Start","time_sec":570,"temp_c":205}]'::jsonb;
  saved := public.update_roast_session_record(sid, original, NULL, extended, NULL, 210, 640, NULL);
  ASSERT saved.events = extended, 'predefined events added';
  edited := jsonb_set(jsonb_set(extended, '{6,time_sec}', '580'), '{6,temp_c}', '210');
  saved := public.update_roast_session_record(sid, extended, NULL, edited, NULL, 210, 640, NULL);
  ASSERT saved.events = edited, 'second crack time and temp edited';
  ASSERT saved.events -> 4 = original -> 4, 'unknown row preserved';
  FOREACH kind IN ARRAY ARRAY['Color Change', 'SC Start', 'Custom'] LOOP
    BEGIN
      candidate := edited || jsonb_build_array(jsonb_build_object('id', 'new-' || kind, 'type', kind, 'time_sec', 590));
      PERFORM public.update_roast_session_record(sid, edited, NULL, candidate, NULL, 210, 640, NULL);
      RAISE EXCEPTION 'duplicate or custom event % accepted', kind;
    EXCEPTION WHEN SQLSTATE 'PT422' THEN NULL;
    END;
  END LOOP;
  FOREACH candidate IN ARRAY ARRAY[
    jsonb_set(edited, '{5,time_sec}', '100'), -- color before Yellow
    jsonb_set(edited, '{6,time_sec}', '610'), -- second crack after Drop
    jsonb_set(edited, '{6,temp_c}', '401'),
    jsonb_set(edited, '{4,time_sec}', '710'), -- unknown row must stay immutable
    jsonb_set(edited, '{6,type}', '"Custom"'),
    edited - 5
  ] LOOP
    BEGIN
      PERFORM public.update_roast_session_record(sid, edited, NULL, candidate, NULL, 210, 640, NULL);
      RAISE EXCEPTION 'invalid event edit accepted';
    EXCEPTION WHEN SQLSTATE 'PT422' THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM public.update_roast_session_record(sid, original, NULL, edited, NULL, 210, 640, NULL);
    RAISE EXCEPTION 'stale edit accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  RAISE NOTICE 'extended_roast_events: ok';
END $$;
ROLLBACK;
