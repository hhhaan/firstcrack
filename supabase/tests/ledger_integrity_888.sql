-- Local only. Rolls back.
-- Covers #890 #891 #892 #895 #897 #898 against the current functions.
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_slack;

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  bean_id uuid;
  product_a uuid := gen_random_uuid();
  product_b uuid := gen_random_uuid();
  connection_id uuid := gen_random_uuid();
  plan_id uuid;
  batch_id uuid;
  session_id uuid := gen_random_uuid();
  op_id uuid := gen_random_uuid();
  blend_op uuid := gen_random_uuid();
  bean_b uuid;
  product_c uuid := gen_random_uuid();
  blend_id uuid := gen_random_uuid();
  requirements jsonb;
  covered integer;
  uncovered integer;
  wac numeric;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (owner_id, 'ledger-888@example.invalid');
  UPDATE public.profiles SET plan = 'team' WHERE id = owner_id;
  INSERT INTO public.beans(user_id, name) VALUES (owner_id, 'A') RETURNING id INTO bean_id;
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type, cost_per_kg)
    VALUES (owner_id, bean_id, 5000, 'purchase', 10000),
           (owner_id, bean_id, 5000, 'purchase', 20000);
  INSERT INTO public.beans(user_id, name) VALUES (owner_id, 'B') RETURNING id INTO bean_b;
  INSERT INTO public.products(id, user_id, name, net_weight_grams, bean_id)
    VALUES (product_a, owner_id, 'A250', 250, bean_id),
           (product_b, owner_id, 'B250', 250, bean_id),
           (product_c, owner_id, 'C250', 250, bean_b);
  INSERT INTO public.blends(id, user_id, name) VALUES (blend_id, owner_id, 'Mix');
  INSERT INTO public.blend_components(blend_id, bean_id, ratio_pct) VALUES (blend_id, bean_id, 100);
  INSERT INTO public.orders(user_id, platform, platform_order_id, status, ordered_at)
    VALUES (owner_id, 'manual', 'need-covered', 'paid', now()),
           (owner_id, 'manual', 'need-open', 'paid', now());
  INSERT INTO public.order_lines(order_id, user_id, platform_line_id, product_id, title, quantity, status)
  SELECT o.id, owner_id, 'line', CASE o.platform_order_id WHEN 'need-covered' THEN product_b ELSE product_c END,
         'Bag', 4, 'active'
  FROM public.orders o
  WHERE o.user_id = owner_id AND o.platform_order_id IN ('need-covered', 'need-open');
  INSERT INTO public.product_stock_events(user_id, product_id, delta_units, event_type)
    VALUES (owner_id, product_a, 20, 'roast_inbound');
  INSERT INTO public.roasted_stock_events(user_id, bean_id, delta_grams, event_type)
    VALUES (owner_id, bean_id, 1000, 'adjustment');
  INSERT INTO public.sales_channel_connections(
    id, user_id, platform, shop_identifier, status, auto_fulfill_on_shipped
  ) VALUES (connection_id, owner_id, 'shopify', 'ledger-888', 'active', true);

  SET LOCAL ROLE service_role;
  PERFORM public.sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'qty-ship', 'status', 'paid', 'orderedAt', '2026-10-10T00:00:00Z',
    'currency', 'KRW', 'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line', 'productId', product_a, 'title', 'A', 'quantity', 1, 'status', 'active'
    ))
  )));
  PERFORM public.sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'qty-ship', 'status', 'shipped', 'orderedAt', '2026-10-10T00:00:00Z',
    'currency', 'KRW', 'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line', 'productId', product_a, 'title', 'A', 'quantity', 3, 'status', 'active'
    ))
  )));
  ASSERT (SELECT quantity = 3 FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id WHERE o.platform_order_id = 'qty-ship'), 'line stores 3';
  ASSERT (SELECT SUM(delta_units) = -3 FROM public.product_stock_events
    WHERE product_id = product_a AND event_type = 'order_fulfillment'), 'shipped the new quantity';
  PERFORM public.sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'qty-ship', 'status', 'cancelled', 'orderedAt', '2026-10-10T00:00:00Z',
    'currency', 'KRW', 'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line', 'productId', product_a, 'title', 'A', 'quantity', 3, 'status', 'cancelled'
    ))
  )));
  ASSERT (SELECT SUM(delta_units) = 0 FROM public.product_stock_events WHERE product_id = product_a
    AND event_type IN ('order_fulfillment', 'order_cancel')), 'cancel restores the shipped 3';
  ASSERT (SELECT SUM(delta_units) = 20 FROM public.product_stock_events WHERE product_id = product_a),
    'stock returns to 20';

  PERFORM public.sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'later-qty', 'status', 'shipped', 'orderedAt', '2026-10-10T00:00:00Z',
    'currency', 'KRW', 'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line', 'productId', product_a, 'title', 'A', 'quantity', 1, 'status', 'active'
    ))
  )));
  PERFORM public.sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'later-qty', 'status', 'shipped', 'orderedAt', '2026-10-10T00:00:00Z',
    'currency', 'KRW', 'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line', 'productId', product_a, 'title', 'A', 'quantity', 3, 'status', 'active'
    ))
  )));
  PERFORM public.sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'later-qty', 'status', 'cancelled', 'orderedAt', '2026-10-10T00:00:00Z',
    'currency', 'KRW', 'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line', 'productId', product_a, 'title', 'A', 'quantity', 3, 'status', 'cancelled'
    ))
  )));
  ASSERT (SELECT SUM(delta_units) FILTER (WHERE event_type = 'order_cancel') = 1
    FROM public.product_stock_events pse
    JOIN public.order_lines ol ON ol.id = pse.reference_id
    JOIN public.orders o ON o.id = ol.order_id
    WHERE o.platform_order_id = 'later-qty'), 'later quantity does not inflate the restore';
  RESET ROLE;

  INSERT INTO public.roast_day_plans(user_id, date) VALUES (owner_id, '2099-04-01') RETURNING id INTO plan_id;
  INSERT INTO public.roast_plan_batches(
    plan_id, bean_id, bean_name, batch_size_kg, target_roasted_kg, yield_pct, status
  ) VALUES (plan_id, bean_id, 'A', 1, 3, 1, 'pending') RETURNING id INTO batch_id;
  ASSERT (SELECT batch_count = 3 FROM public.roast_plan_batches WHERE id = batch_id), 'three slots';
  INSERT INTO public.roast_sessions(
    id, user_id, status, weight_grams, bean_id, plan_batch_id
  ) VALUES (session_id, owner_id, 'completed', 1000, bean_id, batch_id);
  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type, reference_id)
    VALUES (owner_id, bean_id, -1000, 'roast', session_id);

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  requirements := public.get_roasting_requirements(owner_id);
  SELECT COALESCE((elem->>'green_grams_needed')::integer, -1) INTO covered
  FROM jsonb_array_elements(requirements->'beans') elem
  WHERE elem->>'bean_id' = bean_id::text;
  SELECT COALESCE((elem->>'green_grams_needed')::integer, -1) INTO uncovered
  FROM jsonb_array_elements(requirements->'beans') elem
  WHERE elem->>'bean_id' = bean_b::text;
  ASSERT covered = 0, 'bulk covers the open bags';
  ASSERT uncovered = 1176, 'no bulk still converts by yield';

  PERFORM public.complete_plan_batch(batch_id, true);
  PERFORM public.complete_plan_batch(batch_id, true);
  ASSERT (SELECT status = 'done' FROM public.roast_plan_batches WHERE id = batch_id), 'batch done';
  ASSERT (SELECT COALESCE(SUM(-delta_grams), 0) = 2000 FROM public.bean_stock_events
    WHERE reference_id = batch_id AND event_type = 'roast'), 'remainder only, once';
  ASSERT (SELECT delta_grams = 1640 AND is_estimate FROM public.roasted_stock_events
    WHERE reference_id = batch_id), 'estimate covers the two remaining slots';

  PERFORM public.insert_packaging_op(
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'product_id', product_a, 'delta_units', 2,
      'event_type', 'roast_inbound', 'reference_id', op_id
    )),
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'bean_id', bean_id, 'blend_id', null, 'delta_grams', -500,
      'event_type', 'packaging', 'reference_id', op_id
    ))
  );
  PERFORM public.insert_packaging_op(
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'product_id', product_a, 'delta_units', 2,
      'event_type', 'roast_inbound', 'reference_id', op_id
    )),
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'bean_id', bean_id, 'blend_id', null, 'delta_grams', -500,
      'event_type', 'packaging', 'reference_id', op_id
    ))
  );
  ASSERT (SELECT SUM(delta_grams) = 500 FROM public.roasted_stock_events
    WHERE bean_id = bean_id), 'replay does not deduct bulk again';
  BEGIN
    PERFORM public.insert_packaging_op(
      jsonb_build_array(jsonb_build_object(
        'user_id', owner_id, 'product_id', product_b, 'delta_units', 2,
        'event_type', 'roast_inbound', 'reference_id', op_id
      )),
      jsonb_build_array(jsonb_build_object(
        'user_id', owner_id, 'bean_id', bean_id, 'blend_id', null, 'delta_grams', -500,
        'event_type', 'packaging', 'reference_id', op_id
      ))
    );
    RAISE EXCEPTION 'payload reuse must fail';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
  ASSERT (SELECT COUNT(*) = 0 FROM public.product_stock_events
    WHERE product_id = product_b AND event_type = 'roast_inbound'), 'rejected payload wrote nothing';

  PERFORM public.insert_blending_op(jsonb_build_array(
    jsonb_build_object('user_id', owner_id, 'bean_id', bean_id, 'delta_grams', -200,
      'event_type', 'blend_consume', 'reference_id', blend_op),
    jsonb_build_object('user_id', owner_id, 'blend_id', blend_id, 'delta_grams', 200,
      'event_type', 'blend_produce', 'reference_id', blend_op)
  ));
  BEGIN
    PERFORM public.insert_blending_op(jsonb_build_array(
      jsonb_build_object('user_id', owner_id, 'bean_id', bean_id, 'delta_grams', -200,
        'event_type', 'blend_consume', 'reference_id', gen_random_uuid()),
      jsonb_build_object('user_id', owner_id, 'blend_id', blend_id, 'delta_grams', 5000,
        'event_type', 'blend_produce', 'reference_id', gen_random_uuid())
    ));
    RAISE EXCEPTION 'oversized blend must fail';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  SELECT elem.value::text::numeric INTO wac
  FROM jsonb_each(public.get_purchase_wac(owner_id)) elem
  WHERE elem.key = bean_id::text;
  ASSERT wac = 15000, 'wac uses both purchases';
  RESET ROLE;
END;
$$;

ROLLBACK;
