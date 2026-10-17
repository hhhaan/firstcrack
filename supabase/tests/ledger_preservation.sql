-- Local database fixture. Usage:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=11111111-1111-1111-1111-111111111111 -f supabase/tests/ledger_preservation.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  connection_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  bean_id uuid := gen_random_uuid();
  blend_id uuid := gen_random_uuid();
  plan_id uuid;
  batch_id uuid;
  session_id uuid := gen_random_uuid();
  session2_id uuid := gen_random_uuid();
  line_id uuid;
  v_order_id uuid;
  stock_units integer;
  inbound_grams integer;
  op_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (owner_id) ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, plan) VALUES (owner_id, 'team') ON CONFLICT (id) DO UPDATE SET plan = EXCLUDED.plan;

  INSERT INTO sales_channel_connections(id, user_id, platform, shop_identifier, status, auto_fulfill_on_shipped)
  VALUES (connection_id, owner_id, 'shopify', 'ledger-fixture', 'active', true);
  INSERT INTO products(id, user_id, name, sku, net_weight_grams)
  VALUES (v_product_id, owner_id, 'Ledger fixture', 'LEDGER-1', 200);
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 20, 'roast_inbound');

  -- Superuser runs sync (service_role grants vary on trimmed local harnesses).

  -- #890: qty 1 paid, then shipped with qty 3 must deduct 3; cancel restores 3 (stock 20).
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'qty-change-1', 'status', 'paid', 'orderedAt', '2026-10-17T10:00:00Z',
    'buyerName', 'A', 'currency', 'KRW', 'totalAmount', 1000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line-1', 'productId', v_product_id, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1000, 'status', 'active'
    ))
  )));
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'qty-change-1', 'status', 'shipped', 'orderedAt', '2026-10-17T10:00:00Z',
    'buyerName', 'A', 'currency', 'KRW', 'totalAmount', 3000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line-1', 'productId', v_product_id, 'title', 'Coffee', 'quantity', 3, 'unitPrice', 1000, 'status', 'active'
    ))
  )));
  SELECT id INTO v_order_id FROM orders WHERE platform_order_id = 'qty-change-1';
  SELECT id INTO line_id FROM order_lines WHERE order_lines.order_id = v_order_id AND platform_line_id = 'line-1';
  ASSERT (SELECT quantity FROM order_lines WHERE id = line_id) = 3, 'line quantity stored as 3';
  ASSERT (SELECT delta_units FROM product_stock_events WHERE reference_id = line_id AND event_type = 'order_fulfillment') = -3,
    'fulfillment uses stored quantity';
  SELECT COALESCE(SUM(delta_units), 0)::integer INTO stock_units FROM product_stock_events WHERE product_id = v_product_id;
  ASSERT stock_units = 17, 'stock after ship';

  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'qty-change-1', 'status', 'cancelled', 'orderedAt', '2026-10-17T10:00:00Z',
    'buyerName', 'A', 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line-1', 'productId', v_product_id, 'title', 'Coffee', 'quantity', 3, 'unitPrice', 0, 'status', 'cancelled'
    ))
  )));
  SELECT COALESCE(SUM(delta_units), 0)::integer INTO stock_units FROM product_stock_events WHERE product_id = v_product_id;
  ASSERT stock_units = 20, 'cancel restores actual deducted units';
  ASSERT (SELECT delta_units FROM product_stock_events WHERE reference_id = line_id AND event_type = 'order_cancel') = 3,
    'cancel event matches fulfillment';

  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'qty-change-1', 'status', 'cancelled', 'orderedAt', '2026-10-17T10:00:00Z',
    'buyerName', 'A', 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'line-1', 'productId', v_product_id, 'title', 'Coffee', 'quantity', 3, 'unitPrice', 0, 'status', 'cancelled'
    ))
  )));
  SELECT COALESCE(SUM(delta_units), 0)::integer INTO stock_units FROM product_stock_events WHERE product_id = v_product_id;
  ASSERT stock_units = 20, 'double cancel is no-op';

  -- Partial refund restores only outstanding units.
  DELETE FROM product_stock_events WHERE user_id = owner_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type) VALUES (owner_id, v_product_id, 10, 'roast_inbound');
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'partial-refund-1', 'status', 'paid', 'orderedAt', '2026-10-17T11:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 2, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId','pa','productId',v_product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
        jsonb_build_object('platformLineId','pb','productId',v_product_id,'title','B','quantity',1,'unitPrice',1,'status','active')
      )
    ),
    jsonb_build_object(
      'platformOrderId', 'partial-refund-1', 'status', 'shipped', 'orderedAt', '2026-10-17T11:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 2, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId','pa','productId',v_product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
        jsonb_build_object('platformLineId','pb','productId',v_product_id,'title','B','quantity',1,'unitPrice',1,'status','active')
      )
    )
  ));
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId','partial-refund-1','status','refunded','orderedAt','2026-10-17T11:00:00Z',
    'buyerName',null,'currency','KRW','totalAmount',1,'raw','{}'::jsonb,
    'lines',jsonb_build_array(
      jsonb_build_object('platformLineId','pa','productId',v_product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
      jsonb_build_object('platformLineId','pb','productId',v_product_id,'title','B','quantity',1,'unitPrice',1,'status','refunded')
    )
  )));
  ASSERT (SELECT count(*) FROM product_stock_events WHERE event_type='order_cancel'
    AND reference_id IN (SELECT ol.id FROM order_lines ol JOIN orders o ON o.id=ol.order_id WHERE o.platform_order_id='partial-refund-1')) = 1,
    'partial refund one restore';

  -- #894 session inbound correction after batch estimate.
  INSERT INTO beans(id, user_id, name) VALUES (bean_id, owner_id, 'Test bean');
  INSERT INTO blends(id, user_id, name) VALUES (blend_id, owner_id, 'Test blend');
  INSERT INTO roast_day_plans(user_id, date) VALUES (owner_id, '2099-02-01')
    ON CONFLICT (user_id, date) DO UPDATE SET date = EXCLUDED.date RETURNING id INTO plan_id;
  INSERT INTO roast_plan_batches(plan_id, bean_name, bean_id, batch_size_kg, target_roasted_kg, status)
    VALUES (plan_id, 'Test bean', bean_id, 1, 0.8, 'done') RETURNING id INTO batch_id;
  INSERT INTO roast_sessions(id, user_id, bean_id, plan_batch_id, weight_grams, output_weight_grams, status, roasted_at)
    VALUES (session_id, owner_id, bean_id, batch_id, 1000, 850, 'completed', now());
  INSERT INTO roasted_stock_events(user_id, bean_id, delta_grams, event_type, reference_id, is_estimate)
    VALUES (owner_id, bean_id, 850, 'roast_inbound', session_id, false);
  INSERT INTO roasted_stock_events(user_id, bean_id, delta_grams, event_type, reference_id, is_estimate)
    VALUES (owner_id, bean_id, 700, 'roast_inbound', batch_id, true);

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM set_session_output_weight(session_id, 800, 800, false);
  SELECT delta_grams INTO inbound_grams FROM roasted_stock_events WHERE reference_id = session_id AND event_type = 'roast_inbound';
  ASSERT inbound_grams = 800, 'session inbound corrected';
  PERFORM set_session_output_weight(session_id, 800, 800, false);
  SELECT delta_grams INTO inbound_grams FROM roasted_stock_events WHERE reference_id = session_id AND event_type = 'roast_inbound';
  ASSERT inbound_grams = 800, 'idempotent output correction';
  ASSERT (SELECT delta_grams FROM roasted_stock_events WHERE reference_id = batch_id AND event_type = 'roast_inbound') = 700,
    'batch estimate untouched';

  INSERT INTO roast_sessions(id, user_id, bean_id, plan_batch_id, weight_grams, status, roasted_at)
    VALUES (session2_id, owner_id, bean_id, batch_id, 1000, 'completed', now());
  PERFORM upsert_roasted_inbound(session2_id, owner_id, 500, false);
  ASSERT NOT EXISTS (
    SELECT 1 FROM roasted_stock_events WHERE reference_id = session2_id AND event_type = 'roast_inbound'
  ), 'no second inbound when batch estimate exists';

  RESET ROLE;
  -- Superuser runs sync (service_role grants vary on trimmed local harnesses).

  -- #897 blend output cap (integer truncation).
  BEGIN
    PERFORM insert_roasted_stock_events_batch(jsonb_build_array(
      jsonb_build_object('user_id', owner_id, 'bean_id', bean_id, 'blend_id', null, 'delta_grams', -200,
        'event_type', 'blend_consume', 'reference_id', op_id),
      jsonb_build_object('user_id', owner_id, 'bean_id', null, 'blend_id', blend_id, 'delta_grams', 5000,
        'event_type', 'blend_produce', 'reference_id', op_id)
    ));
    RAISE EXCEPTION 'blend_output_exceeds_input not raised';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT NOT EXISTS (
    SELECT 1 FROM roasted_stock_events WHERE reference_id = op_id
  ), 'rejected blend leaves no rows';

  op_id := gen_random_uuid();
  PERFORM insert_roasted_stock_events_batch(jsonb_build_array(
    jsonb_build_object('user_id', owner_id, 'bean_id', bean_id, 'blend_id', null, 'delta_grams', -200,
      'event_type', 'blend_consume', 'reference_id', op_id),
    jsonb_build_object('user_id', owner_id, 'bean_id', null, 'blend_id', blend_id, 'delta_grams', 200,
      'event_type', 'blend_produce', 'reference_id', op_id)
  ));

  op_id := gen_random_uuid();
  BEGIN
    PERFORM insert_roasted_stock_events_batch(jsonb_build_array(
      jsonb_build_object('user_id', owner_id, 'bean_id', bean_id, 'blend_id', null, 'delta_grams', -200,
        'event_type', 'blend_consume', 'reference_id', op_id),
      jsonb_build_object('user_id', owner_id, 'bean_id', null, 'blend_id', blend_id, 'delta_grams', 201,
        'event_type', 'blend_produce', 'reference_id', op_id)
    ));
    RAISE EXCEPTION 'truncation case should reject 201 vs 200';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  op_id := gen_random_uuid();
  PERFORM insert_roasted_stock_events_batch(jsonb_build_array(
    jsonb_build_object('user_id', owner_id, 'bean_id', bean_id, 'blend_id', null, 'delta_grams', -200.9,
      'event_type', 'blend_consume', 'reference_id', op_id),
    jsonb_build_object('user_id', owner_id, 'bean_id', null, 'blend_id', blend_id, 'delta_grams', 200.9,
      'event_type', 'blend_produce', 'reference_id', op_id)
  ));
END $$;

ROLLBACK;
