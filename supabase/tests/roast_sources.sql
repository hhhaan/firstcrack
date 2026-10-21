-- Local only, all fixtures and writes roll back. Run with ON_ERROR_STOP=1.
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_slack;
DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  bean_a uuid; bean_b uuid; foreign_bean uuid; blend uuid; source_id uuid;
  profile public.roast_profiles; saved public.roast_sessions; retry public.roast_sessions;
BEGIN
  INSERT INTO auth.users(id, email) VALUES(owner_id, 'roast-source-owner@example.invalid'), (other_id, 'roast-source-other@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;
  INSERT INTO public.beans(user_id, name) VALUES(owner_id, 'A') RETURNING id INTO bean_a;
  INSERT INTO public.beans(user_id, name) VALUES(owner_id, 'B') RETURNING id INTO bean_b;
  INSERT INTO public.beans(user_id, name) VALUES(other_id, 'Foreign') RETURNING id INTO foreign_bean;
  INSERT INTO public.blends(user_id, name) VALUES(owner_id, 'Modern') RETURNING id INTO blend;
  INSERT INTO public.blend_components(blend_id, bean_id, ratio_pct) VALUES(blend, bean_a, 60), (blend, bean_b, 40);
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type) VALUES(owner_id, bean_a, 10000, 'purchase'), (owner_id, bean_b, 10000, 'purchase');
  INSERT INTO public.roast_sessions(user_id, status, weight_grams) VALUES(owner_id, 'completed', 0) RETURNING id INTO source_id;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  profile := public.save_roast_profile_sources(jsonb_build_object('user_id', owner_id, 'name', 'Multi', 'target_level', 'Medium', 'source_session_id', source_id),
    jsonb_build_array(jsonb_build_object('bean_id', bean_a), jsonb_build_object('blend_id', blend)));
  ASSERT (SELECT count(*) FROM public.roast_profile_sources WHERE profile_id = profile.id) = 2;
  ASSERT profile.default_bean_id IS NULL AND profile.default_blend_id IS NULL;
  BEGIN
    PERFORM public.save_roast_profile_sources(jsonb_build_object('name', 'Must roll back'), jsonb_build_array(jsonb_build_object('bean_id', foreign_bean)), profile.id);
    RAISE EXCEPTION 'foreign source was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT name FROM public.roast_profiles WHERE id = profile.id) = 'Multi', 'metadata and sources must roll back together';
  ASSERT (SELECT count(*) FROM public.roast_profile_sources WHERE profile_id = profile.id) = 2;
  profile := public.save_roast_profile_sources('{}', jsonb_build_array(jsonb_build_object('blend_id', blend)), profile.id);
  ASSERT profile.default_blend_id = blend AND profile.default_bean_id IS NULL;
  saved := public.save_roast_op(jsonb_build_object('id', gen_random_uuid(), 'user_id', owner_id, 'status', 'completed', 'weight_grams', 1000, 'blend_id', blend, 'profile_id', profile.id), true, 1000, 840, false);
  ASSERT saved.blend_id = blend AND saved.bean_id IS NULL AND saved.plan_batch_id IS NULL;
  ASSERT (SELECT -sum(delta_grams) FROM public.bean_stock_events WHERE reference_id = saved.id) = 1000;
  ASSERT (SELECT -sum(delta_grams) FROM public.bean_stock_events WHERE reference_id = saved.id AND bean_id = bean_a) = 600;
  ASSERT (SELECT delta_grams FROM public.roasted_stock_events WHERE reference_id = saved.id AND blend_id = blend) = 840;
  retry := public.save_roast_op(to_jsonb(saved), true, 1000, 840, false);
  ASSERT retry.id = saved.id;
  ASSERT (SELECT count(*) FROM public.bean_stock_events WHERE reference_id = saved.id) = 2, 'retry must not double deduct';
  PERFORM public.upsert_roasted_inbound(saved.id, owner_id, 820, false);
  ASSERT (SELECT delta_grams FROM public.roasted_stock_events WHERE reference_id = saved.id AND blend_id = blend) = 820;
  BEGIN
    PERFORM public.save_roast_op(jsonb_build_object('user_id', owner_id, 'status', 'completed', 'weight_grams', 1000, 'bean_id', bean_a, 'blend_id', blend), true, 1000, 0, false);
    RAISE EXCEPTION 'dual source accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', other_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  ASSERT (SELECT count(*) FROM public.roast_profile_sources WHERE profile_id = profile.id) = 0, 'cross-workspace sources must not be readable';
  RESET ROLE;
END;
$$;
ROLLBACK;
