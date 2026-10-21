-- Local only: run with ON_ERROR_STOP=1. Fixtures, failure injection and writes roll back.
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_slack;
CREATE FUNCTION pg_temp.reject_test_inbound() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('test.reject_inbound', true) = 'yes' THEN
    RAISE EXCEPTION 'injected inbound failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_test_inbound BEFORE INSERT OR UPDATE ON public.roasted_stock_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_test_inbound();

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  org_id uuid; bean_a uuid; bean_b uuid; blend uuid;
  session_id uuid; plan_id uuid; batch_id uuid; planned_id uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (owner_id, 'correction-owner@example.invalid'),
    (member_id, 'correction-member@example.invalid'),
    (other_id, 'correction-other@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;
  INSERT INTO public.organizations(owner_id, name, seat_limit) VALUES(owner_id, 'Corrections', 3) RETURNING id INTO org_id;
  INSERT INTO public.organization_members(org_id, user_id, role) VALUES(org_id, member_id, 'member');
  INSERT INTO public.beans(user_id, name) VALUES(owner_id, 'A') RETURNING id INTO bean_a;
  INSERT INTO public.beans(user_id, name) VALUES(owner_id, 'B') RETURNING id INTO bean_b;
  INSERT INTO public.blends(user_id, name) VALUES(owner_id, 'Blend') RETURNING id INTO blend;
  INSERT INTO public.blend_components(blend_id, bean_id, ratio_pct) VALUES(blend, bean_a, 60), (blend, bean_b, 40);
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type)
    VALUES(owner_id, bean_a, 10000, 'purchase'), (owner_id, bean_b, 10000, 'purchase');
  INSERT INTO public.roast_sessions(user_id, status, weight_grams, blend_id, roast_level)
    VALUES(owner_id, 'completed', 1000, blend, 'Medium') RETURNING id INTO session_id;
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type, reference_id)
    VALUES(owner_id, bean_a, -600, 'roast', session_id), (owner_id, bean_b, -400, 'roast', session_id);
  INSERT INTO public.roast_day_plans(user_id, date) VALUES(owner_id, '2099-02-01') RETURNING id INTO plan_id;
  INSERT INTO public.roast_plan_batches(plan_id, bean_id, bean_name, batch_size_kg, target_roasted_kg, status)
    VALUES(plan_id, bean_a, 'A', 1, 0.85, 'done') RETURNING id INTO batch_id;
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type, reference_id)
    VALUES(owner_id, bean_a, -1000, 'roast', batch_id);
  INSERT INTO public.roast_sessions(user_id, status, weight_grams, bean_id, plan_batch_id)
    VALUES(owner_id, 'completed', 1000, bean_a, batch_id) RETURNING id INTO planned_id;

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_session_output_weight(session_id, NULL, 9999, false);
  ASSERT (SELECT delta_grams = 850 AND is_estimate AND blend_id = blend FROM public.roasted_stock_events WHERE reference_id = session_id), 'legacy estimate must be ignored and blend preserved';
  PERFORM public.set_session_roast_level(session_id, 'Light');
  ASSERT (SELECT delta_grams = 880 AND is_estimate FROM public.roasted_stock_events WHERE reference_id = session_id);
  PERFORM public.correct_session_output_weight(session_id, 800);
  PERFORM public.set_session_roast_level(session_id, 'Dark');
  ASSERT (SELECT delta_grams = 800 AND NOT is_estimate FROM public.roasted_stock_events WHERE reference_id = session_id), 'level must preserve measured inbound';
  BEGIN
    PERFORM public.correct_session_output_weight(session_id, 1001);
    RAISE EXCEPTION 'oversized output accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT output_weight_grams = 800 FROM public.roast_sessions WHERE id = session_id);
  BEGIN
    PERFORM public.correct_session_charge_weight(session_id, 799);
    RAISE EXCEPTION 'charge below output accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT weight_grams = 1000 FROM public.roast_sessions WHERE id = session_id);
  PERFORM public.correct_session_output_weight(session_id, NULL);
  PERFORM public.set_session_charge_weight(session_id, 1001, 2, false);
  ASSERT (SELECT delta_grams = 821 AND is_estimate FROM public.roasted_stock_events WHERE reference_id = session_id), 'legacy charge estimate must be ignored';
  ASSERT (SELECT -sum(delta_grams) = 1001 FROM public.bean_stock_events WHERE reference_id = session_id);
  ASSERT (SELECT delta_grams = -601 FROM public.bean_stock_events WHERE reference_id = session_id AND bean_id = bean_a), 'largest remainder goes to A';
  ASSERT (SELECT delta_grams = -400 FROM public.bean_stock_events WHERE reference_id = session_id AND bean_id = bean_b);

  PERFORM set_config('test.reject_inbound', 'yes', true);
  BEGIN
    PERFORM public.set_session_roast_level(session_id, 'Light');
    RAISE EXCEPTION 'inbound failure not raised';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT roast_level = 'Dark' FROM public.roast_sessions WHERE id = session_id), 'level must roll back with inbound';
  BEGIN
    PERFORM public.correct_session_charge_weight(session_id, 1200);
    RAISE EXCEPTION 'inbound failure not raised';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT weight_grams = 1001 FROM public.roast_sessions WHERE id = session_id);
  ASSERT (SELECT -sum(delta_grams) = 1001 FROM public.bean_stock_events WHERE reference_id = session_id), 'green allocation must roll back with inbound';
  BEGIN
    PERFORM public.correct_session_output_weight(session_id, 700);
    RAISE EXCEPTION 'inbound failure not raised';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT (SELECT output_weight_grams IS NULL FROM public.roast_sessions WHERE id = session_id), 'output must roll back with inbound';
  PERFORM set_config('test.reject_inbound', 'no', true);

  PERFORM public.correct_session_charge_weight(session_id, 0);
  ASSERT NOT EXISTS (SELECT 1 FROM public.roasted_stock_events WHERE reference_id = session_id), 'zero removes estimated inbound';
  ASSERT (SELECT -sum(delta_grams) = 1001 FROM public.bean_stock_events WHERE reference_id = session_id), 'zero preserves green deductions';
  PERFORM public.correct_session_charge_weight(session_id, 1000);
  PERFORM public.set_session_roast_level(session_id, 'Medium-Light');
  ASSERT (SELECT delta_grams = 865 FROM public.roasted_stock_events WHERE reference_id = session_id);
  PERFORM public.set_session_roast_level(session_id, 'Medium-Dark');
  ASSERT (SELECT delta_grams = 835 FROM public.roasted_stock_events WHERE reference_id = session_id);
  PERFORM public.set_session_roast_level(session_id, NULL);
  ASSERT (SELECT delta_grams = 820 FROM public.roasted_stock_events WHERE reference_id = session_id), 'unset level uses fallback';
  PERFORM public.correct_session_charge_weight(planned_id, 1200);
  ASSERT (SELECT delta_grams = -1000 FROM public.bean_stock_events WHERE reference_id = batch_id), 'plan-batch deduction must not rescale';
  ASSERT NOT EXISTS (SELECT 1 FROM public.bean_stock_events WHERE reference_id = planned_id);

  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  PERFORM public.correct_session_output_weight(session_id, 750);
  ASSERT (SELECT delta_grams = 750 AND user_id = owner_id FROM public.roasted_stock_events WHERE reference_id = session_id), 'workspace member keeps owner attribution';
  PERFORM set_config('request.jwt.claim.sub', other_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.correct_session_output_weight(session_id, 700);
    RAISE EXCEPTION 'foreign output correction accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.correct_session_charge_weight(session_id, 2000);
    RAISE EXCEPTION 'foreign charge correction accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.set_session_roast_level(session_id, 'Light');
    RAISE EXCEPTION 'foreign level correction accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  ASSERT (SELECT output_weight_grams = 750 AND weight_grams = 1000 AND roast_level IS NULL FROM public.roast_sessions WHERE id = session_id);
  ASSERT NOT has_function_privilege('anon', 'public.correct_session_output_weight(uuid,integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.correct_session_charge_weight(uuid,integer)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.set_session_roast_level(uuid,text)', 'EXECUTE');
END;
$$;
ROLLBACK;
