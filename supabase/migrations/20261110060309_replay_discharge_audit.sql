-- Independent of saved roasts: a command can precede a save, or the batch can be discarded.
CREATE TABLE public.replay_discharge_audits (
  user_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('intent', 'result')),
  session_id uuid NOT NULL,
  requested_bt double precision,
  observed_bt double precision,
  client_recorded_at_ms double precision NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload jsonb NOT NULL,
  PRIMARY KEY (user_id, actor_id, command_id, kind)
);
CREATE INDEX replay_discharge_audits_session_idx
  ON public.replay_discharge_audits (user_id, session_id, server_received_at);
ALTER TABLE public.replay_discharge_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.replay_discharge_audits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.replay_discharge_audits TO authenticated, service_role;
CREATE POLICY replay_discharge_audits_read ON public.replay_discharge_audits
  FOR SELECT TO authenticated USING (public.has_workspace_access(user_id));

-- Only fixed diagnostic keys and enum strings cross this boundary; never host/path/user text.
CREATE FUNCTION private.valid_replay_audit_value(value jsonb, field text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE item record;
BEGIN
  CASE jsonb_typeof(value)
  WHEN 'object' THEN
    FOR item IN SELECT * FROM jsonb_each(value) LOOP
      IF NOT item.key = ANY (ARRAY[
        'schemaVersion','commandId','recordedAtMs','kind','appVersion','sessionId','connectionEpoch',
        'roaster','temperatureUnit','afterTurningPoint','stepIndex','requested','action','command',
        'targetBt','t','trigger','plan','events','tpTime','bt','heater','policy','requiredDwellMs',
        'pollIntervalMs','maxObservationGapMs','observation','rawBt','elapsed','deviceTimestamp',
        'receivedAtMs','judgedAtMs','ageMs','quality','dwell','firstDeviceTimestamp',
        'lastDeviceTimestamp','firstReceivedAtMs','lastReceivedAtMs','count','minRawBt','maxRawBt',
        'maxDeviceGapMs','maxReceiptGapMs','samples','physicalDoorState','outcome','dispatchedAtMs',
        'dispatchObservation','response','wrote','command_before','command_after','command_held',
        'discharge_open_before','discharge_open_after','error','status','aborted'
      ]) OR NOT private.valid_replay_audit_value(item.value, item.key) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  WHEN 'array' THEN
    IF field NOT IN ('events', 'samples') OR jsonb_array_length(value) > 100 THEN RETURN false; END IF;
    RETURN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(value) e WHERE NOT private.valid_replay_audit_value(e));
  WHEN 'string' THEN
    RETURN CASE field
      WHEN 'commandId' THEN value #>> '{}' ~ '^[0-9a-fA-F-]{36}$'
      WHEN 'sessionId' THEN value #>> '{}' ~ '^[0-9a-fA-F-]{36}$'
      WHEN 'appVersion' THEN value #>> '{}' ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
      WHEN 'roaster' THEN value #>> '{}' IN ('giesen_w45a_w60a', 'virtual')
      WHEN 'temperatureUnit' THEN value #>> '{}' = 'celsius'
      WHEN 'action' THEN value #>> '{}' = 'discharge_open'
      WHEN 'trigger' THEN value #>> '{}' IN ('time', 'bt')
      WHEN 'quality' THEN value #>> '{}' = 'valid'
      WHEN 'physicalDoorState' THEN value #>> '{}' = 'unknown'
      WHEN 'outcome' THEN value #>> '{}' IN ('sent', 'failed', 'unconfirmed', 'cancelled_before_dispatch')
      WHEN 'kind' THEN value #>> '{}' IN ('intent', 'result', 'heater', 'discharge_open', 'sidecar', 'abort', 'timeout', 'unknown')
      WHEN 'status' THEN value #>> '{}' IN ('network', 'timeout')
      ELSE false END;
  WHEN 'number' THEN RETURN abs((value #>> '{}')::numeric) <= 1000000000000000;
  WHEN 'boolean' THEN RETURN field IN ('afterTurningPoint', 'aborted', 'command_held', 'discharge_open_before', 'discharge_open_after');
  WHEN 'null' THEN RETURN true;
  ELSE RETURN false;
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION private.valid_replay_audit_value(jsonb, text) FROM PUBLIC;

-- Sole write API: server supplies actor/receipt time, immutable duplicates must match exactly.
CREATE FUNCTION public.append_replay_discharge_audit(
  p_user_id uuid, p_actor_id uuid, p_payload jsonb
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE existing public.replay_discharge_audits; command uuid; session uuid; event_kind text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id OR p_user_id IS NULL
    OR NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'Audit workspace access denied' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 65536
    OR NOT private.valid_replay_audit_value(p_payload)
    OR p_payload->>'schemaVersion' IS DISTINCT FROM '2'
    OR p_payload->>'kind' NOT IN ('intent','result')
    OR NOT (p_payload ?& ARRAY['commandId','sessionId','recordedAtMs','physicalDoorState'])
    OR jsonb_typeof(p_payload->'recordedAtMs') <> 'number'
    OR p_payload->>'physicalDoorState' IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION 'Invalid audit payload' USING ERRCODE = '22023';
  END IF;
  command := (p_payload->>'commandId')::uuid;
  session := (p_payload->>'sessionId')::uuid;
  event_kind := p_payload->>'kind';
  IF command IS NULL OR session IS NULL OR event_kind IS NULL
    OR (event_kind = 'intent' AND (
      NOT (p_payload ?& ARRAY['requested','observation','dwell','plan','policy','appVersion'])
      OR p_payload#>>'{requested,action}' IS DISTINCT FROM 'discharge_open'
      OR p_payload#>>'{requested,command}' IS DISTINCT FROM '5'
      OR jsonb_typeof(p_payload#>'{requested,targetBt}') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_payload#>'{observation,rawBt}') IS DISTINCT FROM 'number'))
    OR (event_kind = 'result' AND (p_payload->>'outcome' IS NULL OR p_payload->>'outcome' NOT IN
      ('sent','failed','unconfirmed','cancelled_before_dispatch'))) THEN
    RAISE EXCEPTION 'Incomplete audit payload' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.replay_discharge_audits
    (user_id, actor_id, command_id, kind, session_id, requested_bt, observed_bt, client_recorded_at_ms, payload)
  VALUES (p_user_id, auth.uid(), command, event_kind, session,
    (p_payload#>>'{requested,targetBt}')::double precision,
    coalesce(p_payload#>>'{observation,rawBt}', p_payload#>>'{dispatchObservation,rawBt}')::double precision,
    (p_payload->>'recordedAtMs')::double precision, p_payload)
  ON CONFLICT (user_id, actor_id, command_id, kind) DO NOTHING;
  SELECT * INTO STRICT existing FROM public.replay_discharge_audits
    WHERE user_id = p_user_id AND actor_id = auth.uid() AND command_id = command AND kind = event_kind;
  IF existing.payload IS DISTINCT FROM p_payload THEN
    RAISE EXCEPTION 'Audit identity already has a different payload' USING ERRCODE = '23505';
  END IF;
  RETURN existing.server_received_at;
END;
$$;
REVOKE ALL ON FUNCTION public.append_replay_discharge_audit(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_replay_discharge_audit(uuid, uuid, jsonb) TO authenticated;
