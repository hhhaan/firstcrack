-- #619: the app sends fractional duration_seconds. The RPC must round it into
-- the integer column. Payload JSON is produced by saveRoastCore (see
-- src/features/active-roast/model/dbContractPayload.test.ts) and passed as
-- psql variable app_payload: { "save_roast_619": { session, deduct, ... } }.
-- Add another key + SQL file for the next contract; this runner already
-- forwards app_payload to every test.

BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('test.app_payload', :'app_payload', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);

DO $$
DECLARE
  call jsonb := current_setting('test.app_payload')::jsonb -> 'save_roast_619';
  session jsonb;
  saved roast_sessions;
  raw_duration text;
BEGIN
  IF call IS NULL THEN
    RAISE EXCEPTION 'missing save_roast_619 in app_payload';
  END IF;

  session := call -> 'session';
  raw_duration := session ->> 'duration_seconds';
  IF raw_duration IS NULL OR raw_duration !~ '\.' THEN
    RAISE EXCEPTION 'app payload duration_seconds is not fractional: %', raw_duration;
  END IF;

  saved := save_roast_op(
    session,
    (call ->> 'deduct')::boolean,
    (call ->> 'deductionGrams')::integer,
    (call ->> 'inboundGrams')::integer,
    (call ->> 'inboundIsEstimate')::boolean
  );

  ASSERT saved.id = (session ->> 'id')::uuid;
  ASSERT saved.duration_seconds = round(raw_duration::numeric)::integer,
    'fractional app duration_seconds must round into the integer column';
  ASSERT saved.weight_grams = (session ->> 'weight_grams')::integer;
END $$;

ROLLBACK;
