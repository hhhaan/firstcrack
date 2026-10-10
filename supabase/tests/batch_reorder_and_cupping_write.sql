-- Local database only. Supply two existing profile UUIDs. Everything rolls back.
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=... -v other_owner=... -f supabase/tests/batch_reorder_and_cupping_write.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('test.other_owner', :'other_owner', true);

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  other_id uuid := current_setting('test.other_owner')::uuid;
  plan_id uuid;
  other_plan_id uuid;
  batch_a uuid;
  batch_b uuid;
  other_batch uuid;
  event_id uuid;
  other_event_id uuid;
  sample_a uuid;
  sample_b uuid;
  other_sample uuid;
  session_id uuid;
  v_profile_id uuid;
  v_invite_id uuid;
  v_legacy_invite_id uuid;
  participant_id uuid;
  legacy_participant_id uuid;
  first_id uuid;
  first_cupped_at timestamptz;
  rows jsonb;
BEGIN
  UPDATE public.profiles SET plan = 'team' WHERE id IN (owner_id, other_id);
  INSERT INTO public.roast_day_plans(user_id, date) VALUES (owner_id, '2099-10-01') RETURNING id INTO plan_id;
  INSERT INTO public.roast_day_plans(user_id, date) VALUES (other_id, '2099-10-01') RETURNING id INTO other_plan_id;
  INSERT INTO public.roast_plan_batches(plan_id, bean_name, batch_size_kg, target_roasted_kg, order_index)
    VALUES (plan_id, 'A', 1, 0.8, 10) RETURNING id INTO batch_a;
  INSERT INTO public.roast_plan_batches(plan_id, bean_name, batch_size_kg, target_roasted_kg, order_index)
    VALUES (plan_id, 'B', 1, 0.8, 11) RETURNING id INTO batch_b;
  INSERT INTO public.roast_plan_batches(plan_id, bean_name, batch_size_kg, target_roasted_kg, order_index)
    VALUES (other_plan_id, 'Other', 1, 0.8, 12) RETURNING id INTO other_batch;

  INSERT INTO public.cupping_events(user_id, title, form_snapshot)
    VALUES (owner_id, 'D test', '{}'::jsonb) RETURNING id INTO event_id;
  INSERT INTO public.cupping_events(user_id, title, form_snapshot)
    VALUES (other_id, 'Other', '{}'::jsonb) RETURNING id INTO other_event_id;
  INSERT INTO public.roast_sessions(user_id, weight_grams, status) VALUES (owner_id, 1000, 'completed') RETURNING id INTO session_id;
  INSERT INTO public.roast_profiles(user_id, name, target_level, source_session_id)
    VALUES (owner_id, 'D profile', 'Medium', session_id) RETURNING id INTO v_profile_id;
  UPDATE public.roast_sessions SET profile_id = v_profile_id WHERE id = session_id;
  INSERT INTO public.cupping_samples(event_id, user_id, roast_session_id, label, sort_order)
    VALUES (event_id, owner_id, session_id, 'A', 10) RETURNING id INTO sample_a;
  INSERT INTO public.cupping_samples(event_id, user_id, label, sort_order)
    VALUES (event_id, owner_id, 'B', 11) RETURNING id INTO sample_b;
  INSERT INTO public.cupping_samples(event_id, user_id, label, sort_order)
    VALUES (other_event_id, other_id, 'Other', 12) RETURNING id INTO other_sample;
  INSERT INTO public.cupping_invites(token, user_id, event_id, expires_at)
    VALUES ('d-batch', owner_id, event_id, now() + interval '1 day') RETURNING id INTO v_invite_id;
  INSERT INTO public.cupping_invites(token, user_id, sample_id, roast_session_id, expires_at)
    VALUES ('d-legacy', owner_id, sample_a, session_id, now() + interval '1 day') RETURNING id INTO v_legacy_invite_id;
  INSERT INTO public.cupping_participants(invite_id, user_id, cupped_by)
    VALUES (v_invite_id, owner_id, 'Cupper') RETURNING id INTO participant_id;
  INSERT INTO public.cupping_participants(invite_id, user_id, cupped_by)
    VALUES (v_legacy_invite_id, owner_id, 'Legacy') RETURNING id INTO legacy_participant_id;

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.reorder_plan_batches(plan_id, ARRAY[]::uuid[]);
  PERFORM public.reorder_plan_batches(plan_id, ARRAY[batch_a]);
  ASSERT (SELECT order_index FROM public.roast_plan_batches WHERE id = batch_a) = 1;
  PERFORM public.reorder_plan_batches(plan_id, ARRAY[batch_b, batch_a]);
  ASSERT (SELECT order_index FROM public.roast_plan_batches WHERE id = batch_b) = 1;
  ASSERT (SELECT order_index FROM public.roast_plan_batches WHERE id = batch_a) = 2;
  BEGIN
    PERFORM public.reorder_plan_batches(plan_id, ARRAY[batch_a, batch_a]);
    RAISE EXCEPTION 'duplicate plan id accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.reorder_plan_batches(plan_id, ARRAY[batch_a, other_batch]);
    RAISE EXCEPTION 'foreign plan id accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  ASSERT (SELECT order_index FROM public.roast_plan_batches WHERE id = batch_a) = 2, 'failed reorder rolled back';

  PERFORM public.reorder_cupping_samples(event_id, ARRAY[]::uuid[]);
  PERFORM public.reorder_cupping_samples(event_id, ARRAY[sample_b, sample_a]);
  ASSERT (SELECT sort_order FROM public.cupping_samples WHERE id = sample_b) = 0;
  ASSERT (SELECT sort_order FROM public.cupping_samples WHERE id = sample_a) = 1;
  BEGIN
    PERFORM public.reorder_cupping_samples(event_id, ARRAY[sample_a, sample_a]);
    RAISE EXCEPTION 'duplicate sample id accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.reorder_cupping_samples(event_id, ARRAY[sample_a, other_sample]);
    RAISE EXCEPTION 'foreign/invisible sample accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.profiles SET plan = 'read_only' WHERE id = owner_id;
  ASSERT public.profile_write_error(owner_id) = 'read_only_plan';
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  ASSERT auth.role() = 'authenticated';
  BEGIN
    PERFORM public.reorder_plan_batches(plan_id, ARRAY[batch_a]);
    RAISE EXCEPTION 'readonly reorder accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;

  SET LOCAL ROLE service_role;
  SELECT jsonb_agg(to_jsonb(w) ORDER BY w.sample_id::text) INTO rows
  FROM public.write_cupping_scorecards_batch(v_invite_id, participant_id, 'Cupper', false, jsonb_build_array(
    jsonb_build_object('sample_id', sample_a, 'roast_session_id', session_id, 'scores', '{"aroma":8}'::jsonb,
      'total_score', 84, 'defects', 0, 'notes', 'first', 'descriptors', '["citrus"]'::jsonb, 'form_version', 'sca_v1')
  )) AS w;
  SELECT c.id, c.cupped_at INTO first_id, first_cupped_at FROM public.cuppings AS c
    WHERE c.invite_id = v_invite_id AND c.sample_id = sample_a AND c.cupped_by = 'Cupper';
  ASSERT (rows->0->>'created')::boolean;
  ASSERT (SELECT roast_profile_id FROM public.cuppings WHERE id = first_id) = v_profile_id, 'profile must come from session';

  SELECT jsonb_agg(to_jsonb(w)) INTO rows
  FROM public.write_cupping_scorecards_batch(v_invite_id, participant_id, 'Cupper', false, jsonb_build_array(
    jsonb_build_object('sample_id', sample_a, 'roast_session_id', session_id, 'scores', '{"aroma":9}'::jsonb,
      'total_score', 85, 'defects', 0, 'notes', 'updated', 'descriptors', '[]'::jsonb, 'form_version', 'sca_v1'),
    jsonb_build_object('sample_id', sample_b, 'roast_session_id', NULL, 'scores', '{"aroma":7}'::jsonb,
      'total_score', 80, 'defects', 1, 'notes', NULL, 'descriptors', '[]'::jsonb, 'form_version', 'sca_v1')
  )) AS w;
  ASSERT jsonb_array_length(rows) = 2;
  ASSERT (rows->0->>'id')::uuid = first_id AND NOT (rows->0->>'created')::boolean, 'existing identity/order preserved';
  ASSERT (SELECT cupped_at FROM public.cuppings WHERE id = first_id) = first_cupped_at, 'initial cupped_at preserved';
  ASSERT (rows->1->>'created')::boolean;

  -- Same payload retry converges on the expression/partial unique row.
  PERFORM * FROM public.write_cupping_scorecards_batch(v_invite_id, participant_id, 'Cupper', false, jsonb_build_array(
    jsonb_build_object('sample_id', sample_a, 'roast_session_id', session_id, 'scores', '{"aroma":9}'::jsonb,
      'total_score', 85, 'defects', 0, 'notes', 'updated', 'descriptors', '[]'::jsonb, 'form_version', 'sca_v1')
  ));
  ASSERT (SELECT count(*) FROM public.cuppings AS c WHERE c.invite_id = v_invite_id AND c.sample_id = sample_a AND c.cupped_by = 'Cupper') = 1;

  INSERT INTO public.cupping_participants(invite_id, user_id, cupped_by)
    VALUES (v_invite_id, owner_id, 'Atomic') RETURNING id INTO participant_id;
  BEGIN
    PERFORM * FROM public.write_cupping_scorecards_batch(v_invite_id, participant_id, 'Atomic', true, jsonb_build_array(
      jsonb_build_object('sample_id', sample_a, 'roast_session_id', session_id, 'scores', '{}'::jsonb,
        'total_score', 70, 'defects', 0, 'descriptors', '[]'::jsonb),
      jsonb_build_object('sample_id', other_sample, 'scores', '{}'::jsonb,
        'total_score', 70, 'defects', 0, 'descriptors', '[]'::jsonb)
    ));
    RAISE EXCEPTION 'mixed-scope cards accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.cuppings AS c WHERE c.invite_id = v_invite_id AND c.cupped_by = 'Atomic'), 'mixed batch rolled back';
  ASSERT (SELECT published_at FROM public.cupping_participants WHERE id = participant_id) IS NULL,
    'failed publish marked participant published';

  SELECT jsonb_agg(to_jsonb(w)) INTO rows
  FROM public.write_cupping_scorecards_batch(v_legacy_invite_id, legacy_participant_id, 'Legacy', false, jsonb_build_array(
    jsonb_build_object('sample_id', sample_a, 'roast_session_id', session_id, 'scores', '{}'::jsonb,
      'total_score', 75, 'defects', 0, 'descriptors', '[]'::jsonb)
  )) AS w;
  ASSERT jsonb_array_length(rows) = 1, 'legacy resubmission path works';

  PERFORM * FROM public.write_cupping_scorecards_batch(v_legacy_invite_id, legacy_participant_id, 'Legacy', true,
    jsonb_build_array(jsonb_build_object('sample_id', sample_a, 'roast_session_id', session_id,
      'scores', '{}'::jsonb, 'total_score', 76, 'defects', 0, 'descriptors', '[]'::jsonb)));
  ASSERT (SELECT published_at FROM public.cupping_participants WHERE id = legacy_participant_id) IS NOT NULL;
  BEGIN
    PERFORM * FROM public.write_cupping_scorecards_batch(v_legacy_invite_id, legacy_participant_id, 'Legacy', false,
      jsonb_build_array(jsonb_build_object('sample_id', sample_a, 'roast_session_id', session_id,
        'scores', '{}'::jsonb, 'total_score', 77, 'defects', 0, 'descriptors', '[]'::jsonb)));
    RAISE EXCEPTION 'published participant edited through legacy path';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  ASSERT (SELECT total_score FROM public.cuppings
    WHERE invite_id = v_legacy_invite_id AND cupped_by = 'Legacy') = 76, 'published score overwritten';

  RESET ROLE;
END $$;
ROLLBACK;
