-- Local seeded database only. Supply two existing writable profile UUIDs that do
-- not share a workspace:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v owner='00000000-0000-0000-0000-000000000000' \
--     -v other_owner='00000000-0000-0000-0000-000000000001' \
--     -f supabase/tests/save_blend.sql
-- Apply supabase/migrations/20260928151000_save_blend.sql first
-- (`supabase db reset` / `supabase migration up` on the local stack).
-- Run as local postgres; this tests the RPC contract, not authenticated RLS.
BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('test.other_owner', :'other_owner', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);
DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  other_id uuid := current_setting('test.other_owner')::uuid;
  bean_a uuid;
  bean_b uuid;
  saved_id uuid;
  good jsonb;
  missing_bean uuid := gen_random_uuid();
BEGIN
  INSERT INTO beans(user_id, name) VALUES (owner_id, 'save-blend-a') RETURNING id INTO bean_a;
  INSERT INTO beans(user_id, name) VALUES (owner_id, 'save-blend-b') RETURNING id INTO bean_b;
  good := jsonb_build_array(
    jsonb_build_object('bean_id', bean_a, 'ratio_pct', 60),
    jsonb_build_object('bean_id', bean_b, 'ratio_pct', 40)
  );

  saved_id := save_blend(
    p_name => '  House  ',
    p_components => good,
    p_user_id => owner_id,
    p_description => '  daily  '
  );
  ASSERT (SELECT name FROM blends WHERE id = saved_id) = 'House';
  ASSERT (SELECT description FROM blends WHERE id = saved_id) = 'daily';
  ASSERT (SELECT count(*) FROM blend_components WHERE blend_id = saved_id) = 2;
  ASSERT (SELECT count(*) FROM blends WHERE user_id = owner_id AND name = 'House') = 1;

  -- Duplicate beans never leave a header.
  BEGIN
    PERFORM save_blend(
      p_name => 'Dup',
      p_components => jsonb_build_array(
        jsonb_build_object('bean_id', bean_a, 'ratio_pct', 50),
        jsonb_build_object('bean_id', bean_a, 'ratio_pct', 50)
      ),
      p_user_id => owner_id
    );
    RAISE EXCEPTION 'test: duplicate bean accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'blend_duplicate_bean' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM blends WHERE name = 'Dup' AND user_id = owner_id);

  -- Bad ratio never leaves a header.
  BEGIN
    PERFORM save_blend(
      p_name => 'Short',
      p_components => jsonb_build_array(
        jsonb_build_object('bean_id', bean_a, 'ratio_pct', 40),
        jsonb_build_object('bean_id', bean_b, 'ratio_pct', 40)
      ),
      p_user_id => owner_id
    );
    RAISE EXCEPTION 'test: bad ratio accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'blend_ratio_sum' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM blends WHERE name = 'Short' AND user_id = owner_id);

  -- Header insert + component FK failure is one transaction: no orphan blend.
  BEGIN
    PERFORM save_blend(
      p_name => 'Orphan',
      p_components => jsonb_build_array(
        jsonb_build_object('bean_id', missing_bean, 'ratio_pct', 100)
      ),
      p_user_id => owner_id
    );
    RAISE EXCEPTION 'test: missing bean accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM blends WHERE name = 'Orphan' AND user_id = owner_id);
  ASSERT NOT EXISTS (SELECT 1 FROM blend_components WHERE bean_id = missing_bean);

  -- Failed update must not rename the blend or drop its components.
  BEGIN
    PERFORM save_blend(
      p_name => 'Renamed',
      p_components => jsonb_build_array(
        jsonb_build_object('bean_id', missing_bean, 'ratio_pct', 100)
      ),
      p_id => saved_id
    );
    RAISE EXCEPTION 'test: missing bean update accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  ASSERT (SELECT name FROM blends WHERE id = saved_id) = 'House';
  ASSERT (SELECT count(*) FROM blend_components WHERE blend_id = saved_id) = 2;

  BEGIN
    PERFORM save_blend(
      p_name => 'Renamed',
      p_components => jsonb_build_array(
        jsonb_build_object('bean_id', bean_a, 'ratio_pct', 50),
        jsonb_build_object('bean_id', bean_a, 'ratio_pct', 50)
      ),
      p_id => saved_id
    );
    RAISE EXCEPTION 'test: duplicate update accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'blend_duplicate_bean' THEN RAISE; END IF;
  END;
  ASSERT (SELECT name FROM blends WHERE id = saved_id) = 'House';
  ASSERT (SELECT ratio_pct FROM blend_components WHERE blend_id = saved_id AND bean_id = bean_a) = 60;

  -- Successful replace is still one row set.
  PERFORM save_blend(
    p_name => 'House 2',
    p_components => jsonb_build_array(
      jsonb_build_object('bean_id', bean_b, 'ratio_pct', 100)
    ),
    p_description => '',
    p_id => saved_id
  );
  ASSERT (SELECT name FROM blends WHERE id = saved_id) = 'House 2';
  ASSERT (SELECT description FROM blends WHERE id = saved_id) IS NULL;
  ASSERT (SELECT count(*) FROM blend_components WHERE blend_id = saved_id) = 1;
  ASSERT EXISTS (
    SELECT 1 FROM blend_components WHERE blend_id = saved_id AND bean_id = bean_b AND ratio_pct = 100
  );

  PERFORM set_config('request.jwt.claim.sub', other_id::text, true);
  BEGIN
    PERFORM save_blend(
      p_name => 'Stolen',
      p_components => good,
      p_user_id => owner_id
    );
    RAISE EXCEPTION 'test: foreign create accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'workspace access denied' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM blends WHERE name = 'Stolen');

  BEGIN
    PERFORM save_blend(
      p_name => 'Hijack',
      p_components => good,
      p_id => saved_id
    );
    RAISE EXCEPTION 'test: foreign update accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'blend not found or access denied' THEN RAISE; END IF;
  END;
  ASSERT (SELECT name FROM blends WHERE id = saved_id) = 'House 2';
END;
$$;
ROLLBACK;
