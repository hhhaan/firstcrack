-- Local database fixture. Usage:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=<profile uuid> -f supabase/tests/channel_orders_batch.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);
INSERT INTO auth.users (id) VALUES (current_setting('test.owner')::uuid) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id) VALUES (current_setting('test.owner')::uuid) ON CONFLICT DO NOTHING;
\ir _channel_order_fixtures.sql

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  connection_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  result jsonb;
  v_saved_order_id uuid;
  event_count integer;
  stranger_id uuid;
  hold_count integer;
  v_hold_b_order_id uuid;
  v_manual_hold_order_id uuid;
  v_cancel_hold_order_id uuid;
  v_no_demand_order_id uuid;
  v_retry_result jsonb;
  v_batch_a_id uuid;
  v_batch_b_id uuid;
  v_foreign_hold_order_id uuid;
  v_foreign_owner_retry_order_id uuid;
BEGIN
  INSERT INTO sales_channel_connections(id, user_id, platform, shop_identifier, status, auto_fulfill_on_shipped)
  VALUES (connection_id, owner_id, 'shopify', 'batch-fixture', 'active', true);
  INSERT INTO products(id, user_id, name, sku, net_weight_grams)
  VALUES (v_product_id, owner_id, 'Batch fixture', 'BATCH-1', 200);
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 100, 'roast_inbound');

  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);

  -- Repeated order ids are applied sequentially: paid → shipped, and the earliest timestamp wins.
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'repeat-1', 'status', 'paid', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', 'A', 'currency', 'KRW', 'totalAmount', 2000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'same-line', 'platformProductId', 'external-1', 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Coffee', 'quantity', 2, 'unitPrice', 1000, 'status', 'active'
      ))
    ),
    jsonb_build_object(
      'platformOrderId', 'repeat-1', 'status', 'shipped', 'orderedAt', '2026-10-09T01:00:00Z',
      'buyerName', 'A', 'currency', 'KRW', 'totalAmount', 2000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'same-line', 'platformProductId', 'external-1', 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Coffee', 'quantity', 2, 'unitPrice', 1000, 'status', 'active'
      ))
    )
  ));
  ASSERT result->>'upserted' = '2', 'counts repeated inputs';
  ASSERT result->>'autoFulfillments' = '1', 'auto fulfillment inserted once';

  SELECT id INTO v_saved_order_id FROM orders WHERE user_id = owner_id AND platform_order_id = 'repeat-1';
  ASSERT (SELECT status FROM orders WHERE id = v_saved_order_id) = 'shipped', 'status merged sequentially';
  ASSERT (SELECT ordered_at FROM orders WHERE id = v_saved_order_id) = '2026-10-09T01:00:00Z'::timestamptz,
    'earliest ordered_at retained';
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE id = v_saved_order_id), 'fulfilled_at set after insertion';

  SELECT count(*) INTO event_count FROM product_stock_events
  WHERE event_type = 'order_fulfillment' AND reference_id IN (SELECT id FROM order_lines WHERE order_id = v_saved_order_id);
  ASSERT event_count = 1, 'one fulfillment event';

  -- Retry is idempotent and a terminal status cannot regress.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'repeat-1', 'status', 'paid', 'orderedAt', '2026-10-11T01:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 2000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'same-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', v_product_id, 'title', 'Coffee', 'quantity', 2, 'unitPrice', 1000, 'status', 'active'
    ))
  )));
  ASSERT (SELECT status FROM orders WHERE id = v_saved_order_id) = 'shipped', 'status does not regress';
  ASSERT (SELECT count(*) FROM product_stock_events WHERE event_type = 'order_fulfillment'
    AND reference_id IN (SELECT id FROM order_lines WHERE order_id = v_saved_order_id)) = 1, 'retry has no duplicate event';

  -- Frozen planner parity: fulfill active lines, then restore only the line that becomes refunded.
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'partial-1', 'status', 'paid', 'orderedAt', '2026-10-10T02:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 2, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId','partial-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
        jsonb_build_object('platformLineId','partial-b','productId',v_product_id,'title','B','quantity',1,'unitPrice',1,'status','active')
      )
    ),
    jsonb_build_object(
      'platformOrderId', 'partial-1', 'status', 'shipped', 'orderedAt', '2026-10-10T02:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 2, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId','partial-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
        jsonb_build_object('platformLineId','partial-b','productId',v_product_id,'title','B','quantity',1,'unitPrice',1,'status','active')
      )
    )
  ));
  ASSERT result->>'autoFulfillments' = '2', 'partial fixture fulfilled both active lines';
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId','partial-1','status','refunded','orderedAt','2026-10-10T02:00:00Z',
    'buyerName',null,'currency','KRW','totalAmount',1,'raw','{}'::jsonb,
    'lines',jsonb_build_array(
      jsonb_build_object('platformLineId','partial-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
      jsonb_build_object('platformLineId','partial-b','productId',v_product_id,'title','B','quantity',1,'unitPrice',1,'status','refunded')
    )
  )));
  ASSERT result->>'cancelledCompensations' = '1', 'partial refund restored one line';
  ASSERT (SELECT count(*) FROM product_stock_events pse JOIN order_lines ol ON ol.id=pse.reference_id
    JOIN orders o ON o.id=ol.order_id WHERE o.platform_order_id='partial-1' AND pse.event_type='order_cancel') = 1,
    'partial refund emitted one restore event';
  ASSERT (SELECT status = 'shipped' AND total_amount = 2 FROM orders WHERE platform_order_id='partial-1'),
    'partial refund keeps the order and its original total';
  ASSERT (SELECT ol.status = 'active' FROM order_lines ol JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='partial-1' AND ol.platform_line_id='partial-a'),
    'unrefunded line stays active';

  -- One cancelled product order must not close the order or erase the gross.
  -- Net sales = total_amount - cancelled/refunded line amounts.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'split-1', 'status', 'paid', 'orderedAt', '2026-10-10T03:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 5500, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(
      jsonb_build_object('platformLineId','split-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',2000,'status','active'),
      jsonb_build_object('platformLineId','split-b','productId',v_product_id,'title','B','quantity',1,'unitPrice',3000,'status','active')
    )
  )));
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'split-1', 'status', 'cancelled', 'orderedAt', '2026-10-10T03:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','split-b','productId',v_product_id,'title','B','quantity',1,'unitPrice',0,'status','cancelled'
    ))
  )));
  ASSERT (SELECT status = 'paid' AND total_amount = 5500 AND fulfilled_at IS NULL
    FROM orders WHERE platform_order_id='split-1'),
    'partial cancel keeps the order open and the gross total';
  ASSERT (SELECT ol.status = 'active' AND ol.quantity = 1 AND ol.unit_price = 2000
    FROM order_lines ol JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='split-1' AND ol.platform_line_id='split-a'),
    'sibling line stays sellable';
  ASSERT (SELECT ol.status = 'cancelled' AND ol.quantity = 1 AND ol.unit_price = 3000
    FROM order_lines ol JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='split-1' AND ol.platform_line_id='split-b'),
    'cancelled line keeps its commercial amount';
  ASSERT (SELECT o.total_amount - COALESCE(sum(ol.unit_price * ol.quantity) FILTER (
      WHERE ol.status IN ('cancelled','refunded')), 0) = 2500
    FROM orders o JOIN order_lines ol ON ol.order_id = o.id
    WHERE o.platform_order_id='split-1' GROUP BY o.total_amount),
    'net sales subtract the cancelled line';
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'split-1', 'status', 'shipped', 'orderedAt', '2026-10-10T03:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','split-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',2000,'status','active'
    ))
  )));
  ASSERT result->>'autoFulfillments' = '1', 'partial cancel still fulfills the active line';
  ASSERT (SELECT status = 'shipped' AND total_amount = 5500 FROM orders WHERE platform_order_id='split-1'),
    'shipping the sibling does not shrink the gross';
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'split-1', 'status', 'cancelled', 'orderedAt', '2026-10-10T03:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','split-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',0,'status','cancelled'
    ))
  )));
  ASSERT result->>'cancelledCompensations' = '1', 'last line cancel restores only that line';
  ASSERT (SELECT status = 'cancelled' AND total_amount = 5500 FROM orders WHERE platform_order_id='split-1'),
    'the order closes once every line is cancelled';

  -- A cancel seen before its siblings must reopen when an active line arrives.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'reopen-1', 'status', 'cancelled', 'orderedAt', '2026-10-10T04:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','reopen-b','productId',v_product_id,'title','B','quantity',1,'unitPrice',1000,'status','cancelled'
    ))
  )));
  ASSERT (SELECT status = 'cancelled' FROM orders WHERE platform_order_id='reopen-1'),
    'a cancel-only snapshot still closes a new order';
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'reopen-1', 'status', 'paid', 'orderedAt', '2026-10-10T04:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 4000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','reopen-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',4000,'status','active'
    ))
  )));
  ASSERT (SELECT status = 'paid' AND total_amount = 5000 FROM orders WHERE platform_order_id='reopen-1'),
    'an active sibling reopens the order and keeps both line amounts';
  ASSERT (SELECT ol.status = 'cancelled' AND ol.unit_price = 1000 FROM order_lines ol
    JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='reopen-1' AND ol.platform_line_id='reopen-b'),
    'the earlier cancelled line stays cancelled';

  -- A local cancel leaves lines active, so a later shipped snapshot must not reopen it.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'local-1', 'status', 'paid', 'orderedAt', '2026-10-10T05:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','local-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',1000,'status','active'
    ))
  )));
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM cancel_order((SELECT id FROM orders WHERE platform_order_id='local-1'));
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'local-1', 'status', 'shipped', 'orderedAt', '2026-10-10T05:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','local-a','productId',v_product_id,'title','A','quantity',1,'unitPrice',1000,'status','active'
    ))
  )));
  ASSERT result->>'autoFulfillments' = '0', 'local cancel does not fulfill on a later snapshot';
  ASSERT (SELECT status = 'cancelled' AND fulfilled_at IS NULL FROM orders WHERE platform_order_id='local-1'),
    'local cancel stays cancelled';

  -- A fulfilled active line becoming cancelled restores once.
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'repeat-1', 'status', 'cancelled', 'orderedAt', '2026-10-09T01:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'same-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', v_product_id, 'title', 'Coffee', 'quantity', 0 + 2, 'unitPrice', 0, 'status', 'cancelled'
    ))
  )));
  ASSERT result->>'cancelledCompensations' = '1', 'cancel compensation reported';
  ASSERT (SELECT count(*) FROM product_stock_events WHERE event_type = 'order_cancel'
    AND reference_id IN (SELECT id FROM order_lines WHERE order_id = v_saved_order_id)) = 1, 'cancel restored once';

  -- Terminal status cannot regress or create a fulfillment on a later shipped snapshot.
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId','repeat-1','status','delivered','orderedAt','2026-10-12T00:00:00Z',
    'buyerName',null,'currency','KRW','totalAmount',0,'raw','{}'::jsonb,
    'lines',jsonb_build_array(jsonb_build_object(
      'platformLineId','same-line','productId',v_product_id,'title','Coffee','quantity',2,'unitPrice',0,'status','active'
    ))
  )));
  ASSERT (SELECT status='cancelled' AND ordered_at='2026-10-09T01:00:00Z'::timestamptz
    FROM orders WHERE id=v_saved_order_id), 'terminal status and earliest time preserved';
  ASSERT result->>'autoFulfillments' = '0' AND result->'stockEventSkips' = '[]'::jsonb,
    'terminal progression created no fulfillment';

  -- Pre-fulfill terminal input has no deductions and never stamps fulfilled_at.
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId','terminal-new','status','cancelled','orderedAt','2026-10-10T00:00:00Z',
    'buyerName',null,'currency','KRW','totalAmount',1,'raw','{}'::jsonb,
    'lines',jsonb_build_array(jsonb_build_object(
      'platformLineId','terminal-line','productId',v_product_id,'title','Cancelled','quantity',1,'unitPrice',1,'status','cancelled'
    ))
  )));
  ASSERT result->>'autoFulfillments'='0' AND result->>'cancelledCompensations'='0',
    'pre-fulfill terminal order emitted no stock event';
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE platform_order_id='terminal-new'),
    'terminal-only fulfillment skip did not stamp fulfilled_at';

  -- A newly seen candidate on an already fulfilled order stays unmapped.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'repeat-1', 'status', 'cancelled', 'orderedAt', '2026-10-09T01:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'late-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', v_product_id, 'title', 'Late mapping', 'quantity', 1, 'unitPrice', 0, 'status', 'cancelled'
    ))
  )));
  ASSERT (SELECT ol.product_id IS NULL FROM order_lines ol WHERE ol.order_id=v_saved_order_id AND ol.platform_line_id='late-line'),
    'fulfilled order rejects later product candidate';

  -- The same external line id in another order is a distinct line.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'other-1', 'status', 'paid', 'orderedAt', '2026-10-10T00:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'same-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', v_product_id, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1000, 'status', 'active'
    ))
  )));
  ASSERT (SELECT count(*) FROM order_lines WHERE platform_line_id = 'same-line') = 2,
    'line identity is scoped to order';

  -- A later candidate maps an unfulfilled line.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'mapping-1', 'status', 'paid', 'orderedAt', '2026-10-10T00:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'mapping-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', null, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
    ))
  )));
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'mapping-1', 'status', 'paid', 'orderedAt', '2026-10-10T00:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'mapping-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', v_product_id, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
    ))
  )));
  ASSERT (SELECT ol.product_id = (SELECT p.id FROM products p WHERE p.sku='BATCH-1') FROM order_lines ol JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='mapping-1'), 'later mapping retained';

  -- Marketplaces may report an empty title. A blank degraded timestamp on an
  -- existing order keeps the stored ordered_at instead of poisoning it.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'mapping-1', 'status', 'paid', 'orderedAt', '',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'mapping-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', v_product_id, 'title', '', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
    ))
  )));
  ASSERT (SELECT ol.title = '' FROM order_lines ol JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='mapping-1'), 'empty marketplace title persisted';
  ASSERT (SELECT ordered_at='2026-10-10T00:00:00Z'::timestamptz FROM orders WHERE platform_order_id='mapping-1'),
    'blank incoming ordered_at preserved existing timestamp';

  -- Auto-fulfillment off and unmapped shipped orders do not get a synthetic fulfilled_at.
  UPDATE sales_channel_connections SET auto_fulfill_on_shipped=false WHERE id=connection_id;
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'auto-off', 'status', 'shipped', 'orderedAt', '2026-10-10T00:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'auto-off-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', v_product_id, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
    ))
  )));
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE platform_order_id='auto-off'), 'auto fulfill off';
  UPDATE sales_channel_connections SET auto_fulfill_on_shipped=true WHERE id=connection_id;
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'unmapped-shipped', 'status', 'shipped', 'orderedAt', '2026-10-10T00:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'unmapped-line', 'platformProductId', null, 'platformVariantId', null,
      'productId', null, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
    ))
  )));
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE platform_order_id='unmapped-shipped'),
    'fulfilled_at requires an inserted fulfillment';

  -- Same SKU on multiple lines: aggregate demand per order (stock 4, lines 2+3 held; sync does not abort).
  DELETE FROM product_stock_events WHERE user_id=owner_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 4, 'roast_inbound');
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'dual-line-short', 'shipped', '2026-10-11T02:00:00Z', 5,
      jsonb_build_array(
        pg_temp.channel_fixture_line('dual-a', v_product_id, 2, 'A'),
        pg_temp.channel_fixture_line('dual-b', v_product_id, 3, 'B')
      )
    )
  ));
  ASSERT result->>'heldFulfillments' = '1', 'dual-line order held';
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE platform_order_id='dual-line-short'),
    'dual-line order not fulfilled';
  ASSERT NOT EXISTS (
    SELECT 1 FROM product_stock_events pse
    JOIN order_lines ol ON ol.id=pse.reference_id
    JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='dual-line-short' AND pse.event_type='order_fulfillment'
  ), 'dual-line short emits no fulfillment events';
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    JOIN orders o ON o.id=h.order_id
    CROSS JOIN LATERAL jsonb_array_elements(h.shortages) s
    WHERE o.platform_order_id='dual-line-short' AND h.resolved_at IS NULL
      AND (s->>'required_units')::integer = 5 AND (s->>'available_units')::integer = 4
  ), 'dual-line hold reports aggregate shortage';

  -- Same wave: earlier multi-line order consumes stock; later order sees reduced balance.
  DELETE FROM product_stock_events WHERE user_id=owner_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 5, 'roast_inbound');
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'dual-wave-early', 'shipped', '2026-10-11T03:00:00Z', 4,
      jsonb_build_array(
        pg_temp.channel_fixture_line('dual-wave-a', v_product_id, 2, 'A'),
        pg_temp.channel_fixture_line('dual-wave-b', v_product_id, 2, 'B')
      )
    ),
    pg_temp.channel_fixture_order(
      'dual-wave-late', 'shipped', '2026-10-11T04:00:00Z', 2,
      jsonb_build_array(pg_temp.channel_fixture_line('dual-wave-late-line', v_product_id, 2, 'Late'))
    )
  ));
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE platform_order_id='dual-wave-early'),
    'earlier dual-line order fulfilled';
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE platform_order_id='dual-wave-late'),
    'later order held after aggregate consumption';
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    JOIN orders o ON o.id=h.order_id
    CROSS JOIN LATERAL jsonb_array_elements(h.shortages) s
    WHERE o.platform_order_id='dual-wave-late' AND h.resolved_at IS NULL
      AND (s->>'required_units')::integer = 2 AND (s->>'available_units')::integer = 1
  ), 'later order shortage reflects remaining stock';

  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 10, 'adjustment');
  PERFORM retry_order_fulfillment((SELECT id FROM orders WHERE platform_order_id='dual-line-short'));
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE platform_order_id='dual-line-short'),
    'retry fulfills dual-line held order';
  ASSERT (SELECT count(*) FROM product_stock_events pse
    JOIN order_lines ol ON ol.id=pse.reference_id
    JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='dual-line-short' AND pse.event_type='order_fulfillment') = 2,
    'dual-line retry deducts every active line';

  -- Scenario 3: one in-stock + one short in the same batch — short order is held, not rolled back.
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'hold-a', 'shipped', '2026-10-11T00:00:00Z', 1,
      jsonb_build_array(pg_temp.channel_fixture_line('hold-a-line', v_product_id, 1, 'A'))
    ),
    pg_temp.channel_fixture_order(
      'hold-b', 'shipped', '2026-10-11T01:00:00Z', 999999,
      jsonb_build_array(pg_temp.channel_fixture_line('hold-b-line', v_product_id, 999999, 'B'))
    )
  ));
  ASSERT result->>'heldFulfillments' = '1', 'one held fulfillment';
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE platform_order_id='hold-a'), 'in-stock order fulfilled';
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE platform_order_id='hold-b'), 'short order not fulfilled';
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    JOIN orders o ON o.id=h.order_id
    WHERE o.platform_order_id='hold-b' AND h.resolved_at IS NULL AND jsonb_array_length(h.shortages)>0
  ), 'open hold with shortages';
  ASSERT NOT EXISTS (
    SELECT 1 FROM product_stock_events pse
    JOIN order_lines ol ON ol.id=pse.reference_id
    JOIN orders o ON o.id=ol.order_id
    WHERE o.platform_order_id='hold-b' AND pse.event_type='order_fulfillment'
  ), 'short order has no fulfillment events';
  SELECT id INTO v_hold_b_order_id FROM orders WHERE platform_order_id='hold-b';

  -- Two orders compete for limited stock: earlier ordered_at wins.
  DELETE FROM product_stock_events WHERE user_id=owner_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 3, 'roast_inbound');
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'race-early', 'shipped', '2026-10-12T00:00:00Z', 2,
      jsonb_build_array(pg_temp.channel_fixture_line('race-early-line', v_product_id, 2, 'Early'))
    ),
    pg_temp.channel_fixture_order(
      'race-late', 'shipped', '2026-10-12T01:00:00Z', 2,
      jsonb_build_array(pg_temp.channel_fixture_line('race-late-line', v_product_id, 2, 'Late'))
    )
  ));
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE platform_order_id='race-early'), 'earlier order fulfilled';
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE platform_order_id='race-late'), 'later order held';
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h JOIN orders o ON o.id=h.order_id
    WHERE o.platform_order_id='race-late' AND h.resolved_at IS NULL
  ), 'later order has open hold';
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    JOIN orders o ON o.id=h.order_id
    CROSS JOIN LATERAL jsonb_array_elements(h.shortages) s
    WHERE o.platform_order_id='race-late' AND h.resolved_at IS NULL
      AND (s->>'required_units')::integer = 2 AND (s->>'available_units')::integer = 1
  ), 'competing-order hold shortages use post-batch balance';

  -- Resync same payloads is idempotent (no duplicate events or holds).
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'race-late', 'shipped', '2026-10-12T01:00:00Z', 2,
      jsonb_build_array(pg_temp.channel_fixture_line('race-late-line', v_product_id, 2, 'Late'))
    )
  ));
  ASSERT (SELECT count(*) FROM order_fulfillment_holds h JOIN orders o ON o.id=h.order_id
    WHERE o.platform_order_id='race-late' AND h.resolved_at IS NULL) = 1, 'single open hold';
  ASSERT (SELECT count(*) FROM product_stock_events pse JOIN order_lines ol ON ol.id=pse.reference_id
    JOIN orders o ON o.id=ol.order_id WHERE o.platform_order_id='race-early' AND pse.event_type='order_fulfillment') = 1,
    'no duplicate fulfillment events';

  -- Restock + retry fulfills once; second retry is a no-op on stock.
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 10, 'adjustment');
  PERFORM retry_order_fulfillment((SELECT id FROM orders WHERE platform_order_id='race-late'));
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE platform_order_id='race-late'), 'retry fulfilled';
  ASSERT NOT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h JOIN orders o ON o.id=h.order_id
    WHERE o.platform_order_id='race-late' AND h.resolved_at IS NULL
  ), 'hold resolved';
  ASSERT (SELECT count(*) FROM product_stock_events pse JOIN order_lines ol ON ol.id=pse.reference_id
    JOIN orders o ON o.id=ol.order_id WHERE o.platform_order_id='race-late' AND pse.event_type='order_fulfillment') = 1,
    'one fulfillment event per line';
  BEGIN
    PERFORM retry_order_fulfillment((SELECT id FROM orders WHERE platform_order_id='race-late'));
    RAISE EXCEPTION 'retry after success accepted';
  EXCEPTION WHEN SQLSTATE 'P0002' OR check_violation THEN NULL;
  END;

  -- Cancel after hold resolves the hold without cancel compensation.
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'hold-b', 'cancelled', '2026-10-11T01:00:00Z', 0,
      jsonb_build_array(
        pg_temp.channel_fixture_line('hold-b-line', v_product_id, 999999, 'B', 0, 'cancelled')
      )
    )
  ));
  ASSERT NOT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h JOIN orders o ON o.id=h.order_id
    WHERE o.platform_order_id='hold-b' AND h.resolved_at IS NULL
  ), 'cancel resolved hold';
  ASSERT result->>'cancelledCompensations' = '0', 'no cancel compensation for unfulfilled hold';

  -- One RPC can persist more rows than PostgREST's default response cap.
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'large-1', 'status', 'paid', 'orderedAt', '2026-10-10T00:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1002, 'raw', '{}'::jsonb,
    'lines', (SELECT jsonb_agg(jsonb_build_object(
      'platformLineId', 'large-' || n, 'platformProductId', null, 'platformVariantId', null,
      'productId', null, 'title', 'Unmapped', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
    )) FROM generate_series(1, 1002) n)
  )));
  ASSERT (SELECT count(*) FROM order_lines ol JOIN orders o ON o.id = ol.order_id
    WHERE o.platform_order_id = 'large-1') = 1002, 'all 1002 lines persisted';

  -- Any error rolls back the entire RPC call.
  BEGIN
    PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
      jsonb_build_object(
        'platformOrderId', 'rollback-1', 'status', 'paid', 'orderedAt', '2026-10-10T00:00:00Z',
        'buyerName', null, 'currency', 'KRW', 'totalAmount', 1, 'raw', '{}'::jsonb, 'lines', '[]'::jsonb
      ),
      jsonb_build_object('platformOrderId', '', 'status', 'paid', 'orderedAt', '2026-10-10T00:00:00Z', 'lines', '[]'::jsonb)
    ));
    RAISE EXCEPTION 'invalid payload accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM orders WHERE platform_order_id = 'rollback-1'), 'batch rolled back';

  -- Canonical zero quantity remains rejected by the database contract and rolls back its whole call.
  BEGIN
    PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
      'platformOrderId', 'zero-1', 'status', 'paid', 'orderedAt', '2026-10-10T00:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'zero-line', 'platformProductId', null, 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Removed', 'quantity', 0, 'unitPrice', 0, 'status', 'cancelled'
      ))
    )));
    RAISE EXCEPTION 'zero quantity accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM orders WHERE platform_order_id='zero-1'), 'zero quantity wrote no order/event';

  -- fulfill_order as authenticated resolves an open hold (hold row is not user-updatable).
  DELETE FROM product_stock_events WHERE user_id=owner_id AND product_id=v_product_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 1, 'roast_inbound');
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'manual-hold', 'status', 'shipped', 'orderedAt', '2026-10-13T00:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 2, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId', 'manual-hold-line', 'productId', v_product_id, 'title', 'Manual', 'quantity', 2, 'unitPrice', 1, 'status', 'active'
    ))
  )));
  SELECT id INTO v_manual_hold_order_id FROM orders WHERE platform_order_id='manual-hold';
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h WHERE h.order_id=v_manual_hold_order_id AND h.resolved_at IS NULL
  ), 'manual-hold has open hold';
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 10, 'adjustment');
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM fulfill_order(v_manual_hold_order_id);
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE id=v_manual_hold_order_id), 'authenticated fulfill succeeded';
  ASSERT NOT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h WHERE h.order_id=v_manual_hold_order_id AND h.resolved_at IS NULL
  ), 'authenticated fulfill resolved hold';
  RESET ROLE;

  -- #924: cancel_order closes an open stock hold in the same transaction.
  DELETE FROM product_stock_events WHERE user_id = owner_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 1, 'roast_inbound');
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'cancel-hold', 'shipped', '2026-10-14T00:00:00Z', 2,
      jsonb_build_array(pg_temp.channel_fixture_line('cancel-hold-line', v_product_id, 2, 'Hold'))
    )
  ));
  SELECT id INTO v_cancel_hold_order_id FROM orders WHERE platform_order_id = 'cancel-hold';
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    WHERE h.order_id = v_cancel_hold_order_id AND h.resolved_at IS NULL
  ), '#924 open hold before cancel';
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM cancel_order(v_cancel_hold_order_id);
  ASSERT (SELECT status = 'cancelled' FROM orders WHERE id = v_cancel_hold_order_id), '#924 order cancelled';
  ASSERT NOT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    WHERE h.order_id = v_cancel_hold_order_id AND h.resolved_at IS NULL
  ), '#924 hold resolved on cancel';
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE id = v_cancel_hold_order_id), '#924 never fulfilled';
  ASSERT NOT EXISTS (
    SELECT 1 FROM product_stock_events pse
    JOIN order_lines ol ON ol.id = pse.reference_id
    WHERE ol.order_id = v_cancel_hold_order_id
  ), '#924 no stock events on unfulfilled cancel';
  RESET ROLE;
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'resolve-guard', 'shipped', '2026-10-14T00:30:00Z', 3,
      jsonb_build_array(pg_temp.channel_fixture_line('resolve-guard-line', v_product_id, 3, 'Guard'))
    )
  ));
  SELECT id INTO v_cancel_hold_order_id FROM orders WHERE platform_order_id = 'resolve-guard';
  BEGIN
    PERFORM resolve_cancelled_order_hold(v_cancel_hold_order_id);
    RAISE EXCEPTION '#924 resolve on non-cancelled order accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- #922: retry with no mapped demand keeps hold open and records no_stock_demand.
  DELETE FROM product_stock_events WHERE user_id = owner_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 1, 'roast_inbound');
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'no-demand', 'shipped', '2026-10-14T01:00:00Z', 2,
      jsonb_build_array(pg_temp.channel_fixture_line('no-demand-mapped', v_product_id, 2, 'Mapped'))
    )
  ));
  SELECT id INTO v_no_demand_order_id FROM orders WHERE platform_order_id = 'no-demand';
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'no-demand', 'status', 'shipped', 'orderedAt', '2026-10-14T01:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 2, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'platformLineId', 'no-demand-mapped', 'platformProductId', null, 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Mapped', 'quantity', 2, 'unitPrice', 1, 'status', 'cancelled'
      ),
      jsonb_build_object(
        'platformLineId', 'no-demand-unmapped', 'platformProductId', null, 'platformVariantId', null,
        'productId', null, 'title', 'Unmapped', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
      )
    )
  )));
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    WHERE h.order_id = v_no_demand_order_id AND h.resolved_at IS NULL
      AND h.reason = 'no_stock_demand'
  ), '#922 sync refresh sets no_stock_demand reason';
  SELECT retry_order_fulfillment(v_no_demand_order_id) INTO v_retry_result;
  ASSERT v_retry_result->>'outcome' = 'no_stock_demand', '#922 retry outcome';
  ASSERT (SELECT fulfilled_at IS NULL FROM orders WHERE id = v_no_demand_order_id), '#922 not fulfilled';
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    WHERE h.order_id = v_no_demand_order_id AND h.resolved_at IS NULL
      AND h.reason = 'no_stock_demand' AND h.shortages = '[]'::jsonb
  ), '#922 hold stays open';
  UPDATE order_lines SET product_id = v_product_id
  WHERE order_id = v_no_demand_order_id AND platform_line_id = 'no-demand-unmapped';
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 5, 'adjustment');
  SELECT retry_order_fulfillment(v_no_demand_order_id) INTO v_retry_result;
  ASSERT v_retry_result->>'outcome' = 'fulfilled', '#922 retry after mapping';
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE id = v_no_demand_order_id), '#922 fulfilled after map';

  -- #923: cancel credit in the same batch counts before later fulfill simulation.
  DELETE FROM product_stock_events WHERE user_id = owner_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 5, 'roast_inbound');
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'batch-cancel-a', 'shipped', '2026-10-14T02:00:00Z', 5,
      jsonb_build_array(pg_temp.channel_fixture_line('batch-cancel-a-line', v_product_id, 5, 'A'))
    )
  ));
  SELECT id INTO v_batch_a_id FROM orders WHERE platform_order_id = 'batch-cancel-a';
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE id = v_batch_a_id), '#923 A fulfilled first';
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'batch-cancel-a', 'cancelled', '2026-10-14T02:00:00Z', 0,
      jsonb_build_array(
        pg_temp.channel_fixture_line('batch-cancel-a-line', v_product_id, 5, 'A', 1, 'cancelled')
      )
    ),
    pg_temp.channel_fixture_order(
      'batch-cancel-b', 'shipped', '2026-10-14T03:00:00Z', 5,
      jsonb_build_array(pg_temp.channel_fixture_line('batch-cancel-b-line', v_product_id, 5, 'B'))
    )
  ));
  SELECT id INTO v_batch_b_id FROM orders WHERE platform_order_id = 'batch-cancel-b';
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM orders WHERE id = v_batch_b_id), '#923 B fulfilled same batch';
  ASSERT NOT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h WHERE h.order_id = v_batch_b_id AND h.resolved_at IS NULL
  ), '#923 B not held';
  ASSERT COALESCE(result->>'heldFulfillments', '0') = '0', '#923 no held in batch';
  ASSERT (SELECT count(*) FROM product_stock_events pse
    JOIN order_lines ol ON ol.id = pse.reference_id
    JOIN orders o ON o.id = ol.order_id
    WHERE o.platform_order_id = 'batch-cancel-b' AND pse.event_type = 'order_fulfillment') = 1,
    '#923 one fulfillment for B';
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'batch-cancel-b', 'shipped', '2026-10-14T03:00:00Z', 5,
      jsonb_build_array(pg_temp.channel_fixture_line('batch-cancel-b-line', v_product_id, 5, 'B'))
    )
  ));
  ASSERT (SELECT count(*) FROM product_stock_events pse
    JOIN order_lines ol ON ol.id = pse.reference_id
    JOIN orders o ON o.id = ol.order_id
    WHERE o.platform_order_id = 'batch-cancel-b' AND pse.event_type = 'order_fulfillment') = 1,
    '#923 replay idempotent';

  DELETE FROM product_stock_events WHERE user_id = owner_id AND product_id = v_product_id;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 1, 'roast_inbound');
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'foreign-guard', 'shipped', '2026-10-14T05:00:00Z', 5,
      jsonb_build_array(pg_temp.channel_fixture_line('foreign-guard-line', v_product_id, 5, 'Guard'))
    )
  ));
  SELECT id INTO v_foreign_hold_order_id FROM orders WHERE platform_order_id = 'foreign-guard';

  stranger_id := '33333333-3333-3333-3333-333333333333'::uuid;
  INSERT INTO auth.users (id) VALUES (stranger_id) ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id) VALUES (stranger_id) ON CONFLICT DO NOTHING;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM sync_channel_orders_batch(owner_id, connection_id, '[]'::jsonb);
    RAISE EXCEPTION 'authenticated execute unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', stranger_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO hold_count FROM order_fulfillment_holds;
  ASSERT hold_count = 0, 'stranger cannot read holds';
  BEGIN
    PERFORM retry_order_fulfillment(v_foreign_hold_order_id);
    RAISE EXCEPTION 'foreign workspace retry allowed';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  SET LOCAL ROLE service_role;
  UPDATE orders SET status = 'cancelled', updated_at = now()
  WHERE id = v_foreign_hold_order_id;
  PERFORM set_config('request.jwt.claim.sub', stranger_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM resolve_cancelled_order_hold(v_foreign_hold_order_id);
    RAISE EXCEPTION 'foreign workspace resolve allowed';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN NULL;
    WHEN OTHERS THEN RAISE;
  END;
  SET LOCAL ROLE service_role;
  ASSERT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h
    WHERE h.order_id = v_foreign_hold_order_id AND h.resolved_at IS NULL
  ), 'foreign resolve denied leaves hold open';
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    pg_temp.channel_fixture_order(
      'foreign-owner-guard', 'shipped', '2026-10-14T06:00:00Z', 5,
      jsonb_build_array(pg_temp.channel_fixture_line('foreign-owner-guard-line', v_product_id, 5, 'Owner'))
    )
  ));
  SELECT id INTO v_foreign_owner_retry_order_id FROM orders WHERE platform_order_id = 'foreign-owner-guard';
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 10, 'adjustment');
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO hold_count FROM order_fulfillment_holds;
  ASSERT hold_count > 0, 'owner can read holds';
  SELECT retry_order_fulfillment(v_foreign_owner_retry_order_id) INTO v_retry_result;
  ASSERT v_retry_result->>'outcome' = 'fulfilled', 'owner authenticated retry succeeds';
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
END $$;

ROLLBACK;
