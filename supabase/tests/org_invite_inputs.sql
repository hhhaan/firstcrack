-- Local fixture: psql <local DB> -v ON_ERROR_STOP=1 -v owner=<fresh profile uuid> -f this-file
BEGIN;
SELECT set_config('request.jwt.claim.sub', :'owner', true);
UPDATE public.profiles SET plan='tester' WHERE id=:'owner'::uuid;

DO $$
DECLARE
  token_value text;
  expiry interval;
  valid_token text := replace(gen_random_uuid()::text, '-', '');
  invite_id uuid;
BEGIN
  FOREACH token_value IN ARRAY ARRAY[NULL,'','a',repeat('a',21),repeat('a',129),repeat('!',22)] LOOP
    BEGIN
      PERFORM public.create_org_invite(token_value);
      RAISE EXCEPTION 'invalid token accepted';
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM='invite_invalid', 'unexpected token validation result: ' || SQLERRM;
    END;
  END LOOP;
  FOREACH expiry IN ARRAY ARRAY[NULL,interval '0',interval '-1 day',interval '8 days'] LOOP
    BEGIN
      PERFORM public.create_org_invite(valid_token,expiry);
      RAISE EXCEPTION 'invalid expiry accepted';
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM='invite_invalid', 'unexpected expiry validation result: ' || SQLERRM;
    END;
  END LOOP;
  invite_id := public.create_org_invite(valid_token);
  ASSERT (SELECT token=valid_token AND expires_at=now()+interval '7 days'
    FROM public.organization_invites WHERE id=invite_id), 'default invite contract preserved';
END $$;
ROLLBACK;
