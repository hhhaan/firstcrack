-- Local database only: run as supabase_admin with ON_ERROR_STOP=1. All fixtures roll back.
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_slack;
DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  other_owner uuid := gen_random_uuid();
  bean_id uuid;
  profile_a uuid;
  profile_b uuid;
  source_id uuid;
  saved public.roast_sessions;
  retried public.roast_sessions;
  stock_before bigint;
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.get_roast_batch_counters(uuid)', 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.get_roast_batch_counters(uuid)', 'EXECUTE');
  ASSERT NOT EXISTS (
    SELECT s.user_id FROM public.roast_sessions s
    LEFT JOIN private.roast_batch_counters c ON c.user_id = s.user_id AND c.profile_id IS NULL
    WHERE s.status = 'completed' GROUP BY s.user_id, c.last_number
    HAVING count(*) > COALESCE(c.last_number, 0)
  ), 'workspace counters continue from existing completed history';
  ASSERT NOT EXISTS (
    SELECT s.user_id, s.profile_id FROM public.roast_sessions s
    LEFT JOIN private.roast_batch_counters c ON c.user_id = s.user_id AND c.profile_id = s.profile_id
    WHERE s.status = 'completed' AND s.profile_id IS NOT NULL GROUP BY s.user_id, s.profile_id, c.last_number
    HAVING count(*) > COALESCE(c.last_number, 0)
  ), 'profile counters continue from existing completed history';
  INSERT INTO auth.users (id, email) VALUES
    (owner_id, 'batch-number-test@example.invalid'),
    (other_owner, 'batch-number-other@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id IN (owner_id, other_owner);
  INSERT INTO public.beans(user_id, name) VALUES(owner_id, 'Green B') RETURNING id INTO bean_id;
  -- A legacy record has no independently known number; never parse its title.
  ALTER TABLE public.roast_sessions DISABLE TRIGGER assign_roast_batch_numbers;
  INSERT INTO public.roast_sessions(user_id, status, weight_grams, batch_name)
    VALUES(owner_id, 'completed', 0, 'Legacy #99') RETURNING id INTO source_id;
  ALTER TABLE public.roast_sessions ENABLE TRIGGER assign_roast_batch_numbers;
  INSERT INTO public.roast_profiles(user_id, name, target_level, source_session_id)
    VALUES(owner_id, 'Profile A', 'Medium', source_id) RETURNING id INTO profile_a;
  INSERT INTO public.roast_profiles(user_id, name, target_level, source_session_id)
    VALUES(owner_id, 'Profile B', 'Medium', source_id) RETURNING id INTO profile_b;
  SELECT (SELECT count(*) FROM public.bean_stock_events) + (SELECT count(*) FROM public.roasted_stock_events) INTO stock_before;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT public.get_roast_batch_counters(owner_id) = '{"total": 0}'::jsonb;
  ASSERT public.get_roast_batch_counters(owner_id) = '{"total": 0}'::jsonb,
    'reading counters does not reserve a number';
  BEGIN
    PERFORM public.get_roast_batch_counters(other_owner);
    RAISE EXCEPTION 'foreign workspace counters accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  saved := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 1000, 'bean_id', bean_id, 'profile_id', profile_a,
    'batch_name', '  Batch C  ', 'batch_title_numbering', 'both',
    'profile_batch_number', 99, 'total_batch_number', 999), false, 0, 0, false);
  ASSERT saved.batch_name = 'Batch C #1 · PR1' AND saved.profile_batch_number = 1 AND saved.total_batch_number = 1,
    'server ignores client numbers and assigns at save';
  retried := public.save_roast_op(jsonb_build_object('id', saved.id, 'user_id', owner_id,
    'profile_id', profile_b, 'profile_batch_number', 9), false, 0, 0, false);
  ASSERT retried.profile_id = profile_a AND retried.profile_batch_number = 1 AND retried.total_batch_number = 1,
    'retry preserves committed profile and numbers';
  UPDATE public.roast_sessions SET batch_name = 'Renamed' WHERE id = saved.id;
  SELECT * INTO saved FROM public.roast_sessions WHERE id = saved.id;
  ASSERT saved.batch_name = 'Renamed' AND saved.profile_batch_number = 1 AND saved.total_batch_number = 1;
  ASSERT saved.bean_id = bean_id AND saved.profile_id = profile_a;
  BEGIN
    UPDATE public.roast_sessions SET profile_id = profile_b WHERE id = saved.id;
    RAISE EXCEPTION 'profile correction was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.roast_sessions SET profile_id = NULL WHERE id = saved.id;
    RAISE EXCEPTION 'profile unlink was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.roast_sessions SET total_batch_number = 2 WHERE id = saved.id;
    RAISE EXCEPTION 'number correction was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
      'status', 'completed', 'weight_grams', 0, 'profile_id', profile_a, 'batch_name', repeat('x', 121)), false, 0, 0, false);
    RAISE EXCEPTION 'oversized title accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- This exception happens after INSERT and counter allocation, testing whole-save rollback.
  BEGIN
    PERFORM public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
      'status', 'completed', 'weight_grams', 0, 'profile_id', profile_a, 'batch_title_numbering', 'invalid'), false, 0, 0, false);
    RAISE EXCEPTION 'invalid display mode accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  retried := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 0, 'profile_id', profile_a, 'batch_name', 'Manual'), false, 0, 0, false);
  ASSERT retried.batch_name = 'Manual' AND retried.profile_batch_number = 2 AND retried.total_batch_number = 2,
    'manual titles retain numbers; retries and failed saves consume none';
  DELETE FROM public.roast_sessions WHERE id = retried.id;
  retried := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 0, 'profile_id', profile_a, 'batch_name', repeat('x', 120),
    'batch_title_numbering', 'profile'), false, 0, 0, false);
  ASSERT retried.profile_batch_number = 3 AND retried.total_batch_number = 3, 'deleted numbers are not reused';
  ASSERT char_length(retried.batch_name) = 120 AND right(retried.batch_name, 3) = ' #3';
  retried := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 0, 'profile_id', profile_b, 'batch_name', 'B', 'batch_title_numbering', 'none'), false, 0, 0, false);
  ASSERT retried.batch_name = 'B' AND retried.profile_batch_number = 1 AND retried.total_batch_number = 4,
    'each profile has its own sequence even when title numbering is hidden';
  retried := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id,
    'status', 'completed', 'weight_grams', 0, 'batch_name', 'No profile', 'batch_title_numbering', 'total',
    'batch_title_prefix', ' LOT# '), false, 0, 0, false);
  ASSERT retried.batch_name = 'No profile LOT5' AND retried.profile_batch_number IS NULL AND retried.total_batch_number = 5;
  ASSERT public.get_roast_batch_counters(owner_id) = jsonb_build_object(
    'total', 5, profile_a::text, 3, profile_b::text, 1), 'cached counters cover every profile';
  ASSERT (SELECT profile_batch_number IS NULL AND total_batch_number IS NULL FROM public.roast_sessions WHERE id = source_id),
    'legacy unknown numbers stay null';
  BEGIN
    PERFORM public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', other_owner,
      'status', 'completed', 'weight_grams', 0), false, 0, 0, false);
    RAISE EXCEPTION 'foreign workspace save accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'foreign workspace save accepted' THEN RAISE; END IF;
  END;
  RESET ROLE;
  -- Existing profile deletion still unlinks the reference; it cannot reassign the roast.
  DELETE FROM public.roast_profiles WHERE id = profile_b;
  SELECT * INTO retried FROM public.roast_sessions WHERE profile_batch_number = 1 AND total_batch_number = 4 AND user_id = owner_id;
  ASSERT retried.profile_id IS NULL AND retried.profile_batch_number = 1;
  ASSERT stock_before = (SELECT count(*) FROM public.bean_stock_events) + (SELECT count(*) FROM public.roasted_stock_events),
    'number/title operations have no stock side effects';
END;
$$;
ROLLBACK;
