-- Local snapshot baseline + current migrations; psql with ON_ERROR_STOP=1. Fixtures roll back.
BEGIN;
-- Do not enqueue external notifications; auth.users is owned by the auth service on PG17.
CREATE OR REPLACE FUNCTION public.notify_signup_slack() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN RETURN NEW; END; $$;
DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  org uuid;
  command uuid := gen_random_uuid();
  session uuid := gen_random_uuid();
  receipt timestamptz;
  before_write timestamptz := clock_timestamp();
  payload jsonb;
  result_payload jsonb;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.append_replay_discharge_audit(uuid,uuid,jsonb)', 'EXECUTE');
  ASSERT NOT has_table_privilege('anon', 'public.replay_discharge_audits', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.replay_discharge_audits', 'INSERT');
  ASSERT NOT has_table_privilege('authenticated', 'public.replay_discharge_audits', 'UPDATE');
  ASSERT NOT has_table_privilege('authenticated', 'public.replay_discharge_audits', 'DELETE');
  INSERT INTO auth.users(id, email) VALUES
    (owner_id, 'audit-owner@example.invalid'),
    (member_id, 'audit-member@example.invalid'),
    (stranger_id, 'audit-stranger@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;
  INSERT INTO public.organizations(owner_id, name, seat_limit) VALUES(owner_id, 'Audit test', 3) RETURNING id INTO org;
  INSERT INTO public.organization_members(org_id, user_id, role) VALUES(org, member_id, 'member');
  payload := jsonb_build_object(
    'schemaVersion', 2, 'commandId', command, 'sessionId', session, 'recordedAtMs', 12000,
    'kind', 'intent', 'appVersion', '1.0.0', 'connectionEpoch', 7, 'roaster', 'giesen_w45a_w60a',
    'temperatureUnit', 'celsius', 'afterTurningPoint', true, 'stepIndex', 1,
    'requested', jsonb_build_object('action','discharge_open','command',5,'targetBt',205,'t',300,'trigger','bt'),
    'plan', '{"tpTime":60,"events":[{"t":0,"bt":180,"heater":80,"trigger":"time"},{"kind":"discharge_open","t":300,"bt":205,"trigger":"bt"}]}'::jsonb,
    'policy', '{"requiredDwellMs":1000,"pollIntervalMs":500,"maxObservationGapMs":1250}'::jsonb,
    'observation', '{"rawBt":205.2,"elapsed":300,"deviceTimestamp":11,"receivedAtMs":11000,"judgedAtMs":11000,"ageMs":0,"quality":"valid"}'::jsonb,
    'dwell', '{"firstDeviceTimestamp":10,"lastDeviceTimestamp":11,"firstReceivedAtMs":10000,"lastReceivedAtMs":11000,"count":3,"minRawBt":205,"maxRawBt":205.2,"maxDeviceGapMs":500,"maxReceiptGapMs":500,"samples":[]}'::jsonb,
    'physicalDoorState', 'unknown');
  result_payload := jsonb_build_object('schemaVersion',2,'commandId',command,'sessionId',session,
    'kind','result','recordedAtMs',12001,'outcome','sent','dispatchedAtMs',12000,
    'dispatchObservation',payload->'observation','response','{"action":"discharge_open","wrote":5,"command_before":0,"command_after":5,"command_held":null,"discharge_open_before":null,"discharge_open_after":null}'::jsonb,
    'error',NULL,'aborted',false,'physicalDoorState','unknown');
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',member_id,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  receipt := public.append_replay_discharge_audit(owner_id, member_id, payload);
  ASSERT receipt >= before_write AND receipt <= clock_timestamp(), 'server receipt uses server time';
  ASSERT receipt = public.append_replay_discharge_audit(owner_id, member_id, payload), 'retry preserves original receipt';
  ASSERT (SELECT count(*) = 1 FROM public.replay_discharge_audits WHERE command_id = command), 'retry is one immutable row';
  ASSERT (SELECT user_id = owner_id AND actor_id = member_id AND session_id = session
    AND requested_bt = 205 AND observed_bt = 205.2 AND client_recorded_at_ms = 12000
    FROM public.replay_discharge_audits WHERE command_id = command), 'searchable workspace/session/BT context';
  PERFORM public.append_replay_discharge_audit(owner_id, member_id, result_payload);
  ASSERT (SELECT count(*) = 2 FROM public.replay_discharge_audits WHERE command_id = command), 'intent/result have distinct identities';
  BEGIN
    PERFORM public.append_replay_discharge_audit(owner_id, member_id, jsonb_set(payload, '{recordedAtMs}', '99'));
    RAISE EXCEPTION 'conflicting duplicate accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.append_replay_discharge_audit(owner_id, owner_id, payload);
    RAISE EXCEPTION 'actor forgery accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.append_replay_discharge_audit(owner_id, NULL, payload);
    RAISE EXCEPTION 'missing actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.append_replay_discharge_audit(stranger_id, member_id, payload);
    RAISE EXCEPTION 'foreign workspace accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.append_replay_discharge_audit(owner_id, member_id, payload || '{"server_received_at":0}');
    RAISE EXCEPTION 'client server clock accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.append_replay_discharge_audit(owner_id, member_id, jsonb_set(payload, '{roaster}', '"secret-host.example.invalid"'));
    RAISE EXCEPTION 'arbitrary diagnostic text accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    UPDATE public.replay_discharge_audits SET payload = '{}' WHERE command_id = command;
    RAISE EXCEPTION 'audit update accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.replay_discharge_audits WHERE command_id = command;
    RAISE EXCEPTION 'audit delete accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) = 2 FROM public.replay_discharge_audits WHERE command_id = command), 'owner can investigate member events';
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', stranger_id::text, true);
  SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) = 0 FROM public.replay_discharge_audits WHERE command_id = command), 'foreign read is hidden';
  RESET ROLE;
  DELETE FROM public.organization_members WHERE org_id = org AND user_id = member_id;
  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.append_replay_discharge_audit(owner_id, member_id, payload);
    RAISE EXCEPTION 'revoked member acknowledged';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END;
$$;
ROLLBACK;
