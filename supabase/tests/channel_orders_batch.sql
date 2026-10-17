-- Local database fixture. Usage:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=<profile uuid> -f supabase/tests/channel_orders_batch.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  connection_id uuid := gen_random_uuid();
  product_id uuid := gen_random_uuid();
  result jsonb;
  v_saved_order_id uuid;
  event_count integer;
BEGIN
  INSERT INTO sales_channel_connections(id, user_id, platform, shop_identifier, status, auto_fulfill_on_shipped)
  VALUES (connection_id, owner_id, 'shopify', 'batch-fixture', 'active', true);
  INSERT INTO products(id, user_id, name, sku, net_weight_grams)
  VALUES (product_id, owner_id, 'Batch fixture', 'BATCH-1', 200);
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, product_id, 100, 'roast_inbound');

  SET LOCAL ROLE service_role;

  -- Repeated order ids are applied sequentially: paid → shipped, and the earliest timestamp wins.
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'repeat-1', 'status', 'paid', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', 'A', 'currency', 'KRW', 'totalAmount', 2000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'same-line', 'platformProductId', 'external-1', 'platformVariantId', null,
        'productId', product_id, 'title', 'Coffee', 'quantity', 2, 'unitPrice', 1000, 'status', 'active'
      ))
    ),
    jsonb_build_object(
      'platformOrderId', 'repeat-1', 'status', 'shipped', 'orderedAt', '2026-10-09T01:00:00Z',
      'buyerName', 'A', 'currency', 'KRW', 'totalAmount', 2000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'same-line', 'platformProductId', 'external-1', 'platformVariantId', null,
        'productId', product_id, 'title', 'Coffee', 'quantity', 2, 'unitPrice', 1000, 'status', 'active'
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
      'productId', product_id, 'title', 'Coffee', 'quantity', 2, 'unitPrice', 1000, 'status', 'active'
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
        jsonb_build_object('platformLineId','partial-a','productId',product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
        jsonb_build_object('platformLineId','partial-b','productId',product_id,'title','B','quantity',1,'unitPrice',1,'status','active')
      )
    ),
    jsonb_build_object(
      'platformOrderId', 'partial-1', 'status', 'shipped', 'orderedAt', '2026-10-10T02:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 2, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId','partial-a','productId',product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
        jsonb_build_object('platformLineId','partial-b','productId',product_id,'title','B','quantity',1,'unitPrice',1,'status','active')
      )
    )
  ));
  ASSERT result->>'autoFulfillments' = '2', 'partial fixture fulfilled both active lines';
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId','partial-1','status','refunded','orderedAt','2026-10-10T02:00:00Z',
    'buyerName',null,'currency','KRW','totalAmount',1,'raw','{}'::jsonb,
    'lines',jsonb_build_array(
      jsonb_build_object('platformLineId','partial-a','productId',product_id,'title','A','quantity',1,'unitPrice',1,'status','active'),
      jsonb_build_object('platformLineId','partial-b','productId',product_id,'title','B','quantity',1,'unitPrice',1,'status','refunded')
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
      jsonb_build_object('platformLineId','split-a','productId',product_id,'title','A','quantity',1,'unitPrice',2000,'status','active'),
      jsonb_build_object('platformLineId','split-b','productId',product_id,'title','B','quantity',1,'unitPrice',3000,'status','active')
    )
  )));
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'split-1', 'status', 'cancelled', 'orderedAt', '2026-10-10T03:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','split-b','productId',product_id,'title','B','quantity',1,'unitPrice',0,'status','cancelled'
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
      'platformLineId','split-a','productId',product_id,'title','A','quantity',1,'unitPrice',2000,'status','active'
    ))
  )));
  ASSERT result->>'autoFulfillments' = '1', 'partial cancel still fulfills the active line';
  ASSERT (SELECT status = 'shipped' AND total_amount = 5500 FROM orders WHERE platform_order_id='split-1'),
    'shipping the sibling does not shrink the gross';
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'split-1', 'status', 'cancelled', 'orderedAt', '2026-10-10T03:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 0, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','split-a','productId',product_id,'title','A','quantity',1,'unitPrice',0,'status','cancelled'
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
      'platformLineId','reopen-b','productId',product_id,'title','B','quantity',1,'unitPrice',1000,'status','cancelled'
    ))
  )));
  ASSERT (SELECT status = 'cancelled' FROM orders WHERE platform_order_id='reopen-1'),
    'a cancel-only snapshot still closes a new order';
  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'reopen-1', 'status', 'paid', 'orderedAt', '2026-10-10T04:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 4000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','reopen-a','productId',product_id,'title','A','quantity',1,'unitPrice',4000,'status','active'
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
      'platformLineId','local-a','productId',product_id,'title','A','quantity',1,'unitPrice',1000,'status','active'
    ))
  )));
  PERFORM cancel_order((SELECT id FROM orders WHERE platform_order_id='local-1'));
  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
    'platformOrderId', 'local-1', 'status', 'shipped', 'orderedAt', '2026-10-10T05:00:00Z',
    'buyerName', null, 'currency', 'KRW', 'totalAmount', 1000, 'raw', '{}'::jsonb,
    'lines', jsonb_build_array(jsonb_build_object(
      'platformLineId','local-a','productId',product_id,'title','A','quantity',1,'unitPrice',1000,'status','active'
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
      'productId', product_id, 'title', 'Coffee', 'quantity', 0 + 2, 'unitPrice', 0, 'status', 'cancelled'
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
      'platformLineId','same-line','productId',product_id,'title','Coffee','quantity',2,'unitPrice',0,'status','active'
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
      'platformLineId','terminal-line','productId',product_id,'title','Cancelled','quantity',1,'unitPrice',1,'status','cancelled'
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
      'productId', product_id, 'title', 'Late mapping', 'quantity', 1, 'unitPrice', 0, 'status', 'cancelled'
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
      'productId', product_id, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1000, 'status', 'active'
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
      'productId', product_id, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
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
      'productId', product_id, 'title', '', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
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
      'productId', product_id, 'title', 'Coffee', 'quantity', 1, 'unitPrice', 1, 'status', 'active'
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

  -- Negative inventory aborts the whole order batch.
  BEGIN
    PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(jsonb_build_object(
      'platformOrderId', 'negative-1', 'status', 'shipped', 'orderedAt', '2026-10-10T00:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 999999, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'negative-line', 'platformProductId', null, 'platformVariantId', null,
        'productId', product_id, 'title', 'Too many', 'quantity', 999999, 'unitPrice', 1, 'status', 'active'
      ))
    )));
    RAISE EXCEPTION 'negative stock accepted';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM = 'insufficient_product_stock', 'unexpected negative stock error';
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM orders WHERE platform_order_id='negative-1'), 'negative stock batch rolled back';

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
        'productId', product_id, 'title', 'Removed', 'quantity', 0, 'unitPrice', 0, 'status', 'cancelled'
      ))
    )));
    RAISE EXCEPTION 'zero quantity accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM orders WHERE platform_order_id='zero-1'), 'zero quantity wrote no order/event';

  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM sync_channel_orders_batch(owner_id, connection_id, '[]'::jsonb);
    RAISE EXCEPTION 'authenticated execute unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
