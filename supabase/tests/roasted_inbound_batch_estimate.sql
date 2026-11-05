-- Local only. Rolls back. Run with psql -v ON_ERROR_STOP=1.
-- #917: a session saved before the batch estimate gets its own measured inbound.
-- A session created after the estimate replaces its share of that estimate.
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_slack;

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  bean_id uuid;
  plan_id uuid;
  batch_id uuid;
  early_id uuid := gen_random_uuid();
  later_id uuid := gen_random_uuid();
  single_id uuid := gen_random_uuid();
  single_batch uuid;
  two_batch uuid;
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  held_id uuid := gen_random_uuid();
  held_batch uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (owner_id, 'inbound-batch@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;
  INSERT INTO public.beans(user_id, name) VALUES (owner_id, 'A') RETURNING id INTO bean_id;
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type)
    VALUES (owner_id, bean_id, 20000, 'purchase');
  INSERT INTO public.roast_day_plans(user_id, date) VALUES (owner_id, '2099-03-01') RETURNING id INTO plan_id;

  -- Two slots. The early session is outside the later 820g estimate.
  INSERT INTO public.roast_plan_batches(
    plan_id, bean_id, bean_name, batch_size_kg, target_roasted_kg, yield_pct, status
  ) VALUES (plan_id, bean_id, 'A', 1, 2, 1, 'done') RETURNING id INTO batch_id;
  ASSERT (SELECT batch_count FROM public.roast_plan_batches WHERE id = batch_id) = 2, 'two slots';
  INSERT INTO public.roast_sessions(
    id, user_id, status, weight_grams, bean_id, plan_batch_id, created_at
  ) VALUES (
    early_id, owner_id, 'completed', 1000, bean_id, batch_id, now() - interval '2 hours'
  );
  INSERT INTO public.roast_sessions(
    id, user_id, status, weight_grams, bean_id, plan_batch_id, created_at
  ) VALUES (
    later_id, owner_id, 'completed', 1000, bean_id, batch_id, now()
  );
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type, reference_id)
    VALUES (owner_id, bean_id, -1000, 'roast', early_id),
           (owner_id, bean_id, -1000, 'roast', batch_id);
  INSERT INTO public.roasted_stock_events(
    user_id, bean_id, delta_grams, event_type, reference_id, is_estimate, created_at
  ) VALUES (
    owner_id, bean_id, 820, 'roast_inbound', batch_id, true, now() - interval '1 hour'
  );

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.correct_session_output_weight(early_id, 910);
  ASSERT (
    SELECT delta_grams = 910 AND NOT is_estimate
    FROM public.roasted_stock_events WHERE reference_id = early_id
  ), 'early session measured inbound';
  ASSERT (
    SELECT delta_grams = 820 AND is_estimate
    FROM public.roasted_stock_events WHERE reference_id = batch_id
  ), 'other slot estimate stays';
  PERFORM public.correct_session_output_weight(early_id, 910);
  ASSERT (
    SELECT count(*) = 1 FROM public.roasted_stock_events WHERE reference_id = early_id
  ), 'repeat does not double the session inbound';

  PERFORM public.upsert_roasted_inbound(later_id, owner_id, 820, true);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.roasted_stock_events WHERE reference_id = later_id
  ), 'estimate is not stacked on the batch row';
  ASSERT (
    SELECT delta_grams = 820 FROM public.roasted_stock_events WHERE reference_id = batch_id
  ), 'stacked estimate leaves the batch row';

  PERFORM public.correct_session_output_weight(later_id, 880);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.roasted_stock_events WHERE reference_id = batch_id
  ), 'last share deletes the batch estimate';
  ASSERT (
    SELECT delta_grams = 880 AND NOT is_estimate
    FROM public.roasted_stock_events WHERE reference_id = later_id
  ), 'later session measured inbound';
  ASSERT (
    SELECT count(*) = 2 AND sum(delta_grams) = 1790
    FROM public.roasted_stock_events WHERE reference_id IN (early_id, later_id)
  ), 'measured rows replace only the covered slot';
  PERFORM public.correct_session_output_weight(later_id, 880);
  ASSERT (
    SELECT count(*) = 1 FROM public.roasted_stock_events WHERE reference_id = later_id
  ), 'repeat keeps one later inbound';
  RESET ROLE;

  -- One slot booked before the session exists: measured output replaces it.
  INSERT INTO public.roast_plan_batches(
    plan_id, bean_id, bean_name, batch_size_kg, target_roasted_kg, yield_pct, status
  ) VALUES (plan_id, bean_id, 'A', 1, 0.8, 1, 'done') RETURNING id INTO single_batch;
  ASSERT (SELECT batch_count FROM public.roast_plan_batches WHERE id = single_batch) = 1, 'one slot';
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type, reference_id)
    VALUES (owner_id, bean_id, -1000, 'roast', single_batch);
  INSERT INTO public.roasted_stock_events(
    user_id, bean_id, delta_grams, event_type, reference_id, is_estimate, created_at
  ) VALUES (
    owner_id, bean_id, 820, 'roast_inbound', single_batch, true, now() - interval '1 hour'
  );
  INSERT INTO public.roast_sessions(
    id, user_id, status, weight_grams, bean_id, plan_batch_id, created_at
  ) VALUES (
    single_id, owner_id, 'completed', 1000, bean_id, single_batch, now()
  );
  SET LOCAL ROLE authenticated;
  PERFORM public.correct_session_output_weight(single_id, 900);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.roasted_stock_events WHERE reference_id = single_batch
  ), 'single slot estimate is replaced';
  ASSERT (
    SELECT delta_grams = 900 AND NOT is_estimate
    FROM public.roasted_stock_events WHERE reference_id = single_id
  ), 'single slot measured inbound';
  PERFORM public.correct_session_output_weight(single_id, 900);
  ASSERT (
    SELECT count(*) = 1 FROM public.roasted_stock_events WHERE reference_id = single_id
  ), 'replaced inbound stays one row';
  RESET ROLE;

  -- Two slots booked first. Each measured session peels one share.
  INSERT INTO public.roast_plan_batches(
    plan_id, bean_id, bean_name, batch_size_kg, target_roasted_kg, yield_pct, status
  ) VALUES (plan_id, bean_id, 'A', 1, 2, 1, 'done') RETURNING id INTO two_batch;
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type, reference_id)
    VALUES (owner_id, bean_id, -2000, 'roast', two_batch);
  INSERT INTO public.roasted_stock_events(
    user_id, bean_id, delta_grams, event_type, reference_id, is_estimate, created_at
  ) VALUES (
    owner_id, bean_id, 1640, 'roast_inbound', two_batch, true, now() - interval '3 hours'
  );
  INSERT INTO public.roast_sessions(
    id, user_id, status, weight_grams, bean_id, plan_batch_id, created_at
  ) VALUES
    (first_id, owner_id, 'completed', 1000, bean_id, two_batch, now() - interval '2 hours'),
    (second_id, owner_id, 'completed', 1000, bean_id, two_batch, now() - interval '1 hour');
  SET LOCAL ROLE authenticated;
  PERFORM public.correct_session_output_weight(first_id, 900);
  ASSERT (
    SELECT delta_grams = 820 AND is_estimate
    FROM public.roasted_stock_events WHERE reference_id = two_batch
  ), 'one of two slots remains estimated';
  ASSERT (
    SELECT delta_grams = 900 AND NOT is_estimate
    FROM public.roasted_stock_events WHERE reference_id = first_id
  ), 'first later session measured';
  PERFORM public.correct_session_output_weight(second_id, 870);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.roasted_stock_events WHERE reference_id = two_batch
  ), 'second measured session removes the last estimate';
  ASSERT (
    SELECT count(*) = 2 AND sum(delta_grams) = 1770
    FROM public.roasted_stock_events WHERE reference_id IN (first_id, second_id)
  ), 'both measured inbounds and no batch row';
  RESET ROLE;

  -- An inbound that already belongs to the session is corrected in place.
  INSERT INTO public.roast_plan_batches(
    plan_id, bean_id, bean_name, batch_size_kg, target_roasted_kg, yield_pct, status
  ) VALUES (plan_id, bean_id, 'A', 1, 0.8, 1, 'done') RETURNING id INTO held_batch;
  INSERT INTO public.roast_sessions(
    id, user_id, status, weight_grams, bean_id, plan_batch_id, output_weight_grams, created_at
  ) VALUES (
    held_id, owner_id, 'completed', 1000, bean_id, held_batch, 850, now() - interval '2 hours'
  );
  INSERT INTO public.roasted_stock_events(
    user_id, bean_id, delta_grams, event_type, reference_id, is_estimate, created_at
  ) VALUES (
    owner_id, bean_id, 850, 'roast_inbound', held_id, false, now() - interval '2 hours'
  );
  INSERT INTO public.roasted_stock_events(
    user_id, bean_id, delta_grams, event_type, reference_id, is_estimate, created_at
  ) VALUES (
    owner_id, bean_id, 700, 'roast_inbound', held_batch, true, now() - interval '1 hour'
  );
  SET LOCAL ROLE authenticated;
  PERFORM public.correct_session_output_weight(held_id, 800);
  PERFORM public.correct_session_output_weight(held_id, 800);
  ASSERT (
    SELECT delta_grams = 800 AND NOT is_estimate
    FROM public.roasted_stock_events WHERE reference_id = held_id
  ), 'existing session inbound corrected once';
  ASSERT (
    SELECT delta_grams = 700 AND is_estimate
    FROM public.roasted_stock_events WHERE reference_id = held_batch
  ), 'unrelated batch estimate stays';
  RESET ROLE;
END;
$$;

ROLLBACK;
