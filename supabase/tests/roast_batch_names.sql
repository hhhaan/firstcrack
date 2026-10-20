-- Local database only: run as supabase_admin with ON_ERROR_STOP=1. All fixtures roll back.
BEGIN;
-- Test fixtures must not invoke the production signup notification trigger.
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_slack;
DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  bean_id uuid;
  profile_id uuid;
  source_id uuid;
  saved public.roast_sessions;
  legacy public.roast_sessions;
  stock_before bigint;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (owner_id, 'batch-name-test@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;
  INSERT INTO public.beans(user_id, name) VALUES(owner_id, 'Green B') RETURNING id INTO bean_id;
  INSERT INTO public.roast_sessions(user_id, status, weight_grams) VALUES(owner_id, 'completed', 0) RETURNING id INTO source_id;
  INSERT INTO public.roast_profiles(user_id, name, target_level, source_session_id)
    VALUES(owner_id, 'Profile A', 'Medium', source_id) RETURNING id INTO profile_id;
  SELECT (SELECT count(*) FROM public.bean_stock_events) + (SELECT count(*) FROM public.roasted_stock_events) INTO stock_before;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  saved := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 1000, 'bean_id', bean_id, 'profile_id', profile_id, 'batch_name', '  Batch C  '), false, 0, 0, false);
  ASSERT saved.batch_name = 'Batch C', 'independent title is trimmed and persisted';
  UPDATE public.roast_sessions SET batch_name = 'Batch D' WHERE id = saved.id;
  SELECT * INTO saved FROM public.roast_sessions WHERE id = saved.id;
  ASSERT saved.batch_name = 'Batch D' AND saved.bean_id = bean_id AND saved.profile_id = profile_id;
  ASSERT (SELECT name FROM public.beans WHERE id = bean_id) = 'Green B';
  ASSERT (SELECT name FROM public.roast_profiles WHERE id = profile_id) = 'Profile A';
  ASSERT saved.bean_label IS NULL;

  legacy := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 0, 'bean_label', 'Legacy free-text name'), false, 0, 0, false);
  ASSERT legacy.batch_name IS NULL AND legacy.bean_label = 'Legacy free-text name', 'legacy labels are preserved';
  legacy := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 0, 'batch_name', '   '), false, 0, 0, false);
  ASSERT legacy.batch_name IS NULL, 'blank titles become null';
  BEGIN
    PERFORM public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
      'status', 'completed', 'weight_grams', 0, 'batch_name', repeat('x', 121)), false, 0, 0, false);
    RAISE EXCEPTION 'oversized title accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RESET ROLE;
  ASSERT stock_before = (SELECT count(*) FROM public.bean_stock_events) + (SELECT count(*) FROM public.roasted_stock_events), 'title operations have no stock side effects';
END;
$$;
ROLLBACK;
