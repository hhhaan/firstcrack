-- Naver detail replay / degraded-line recovery (adapter holds cursor; batch must not clobber good lines).
-- Usage: psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=<profile uuid> -f supabase/tests/channel_order_sync_retry.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  connection_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_order_id uuid;
  v_line_id uuid;
  result jsonb;
  event_count integer;
BEGIN
  INSERT INTO sales_channel_connections(id, user_id, platform, shop_identifier, status, auto_fulfill_on_shipped)
  VALUES (connection_id, owner_id, 'naver', 'sync-retry-fixture', 'active', true);
  INSERT INTO products(id, user_id, name, sku, net_weight_grams)
  VALUES (v_product_id, owner_id, 'Naver fixture', 'NAVER-1', 200);
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, v_product_id, 50, 'roast_inbound');

  SET LOCAL ROLE service_role;

  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'NAVER-ORD-1', 'status', 'paid', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', 'Buyer', 'currency', 'KRW', 'totalAmount', 36000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'PO-LINE-1', 'platformProductId', 'EXT-99', 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Coffee', 'quantity', 4, 'unitPrice', 9000, 'status', 'active'
      ))
    )
  ));
  ASSERT (result->>'upserted')::integer = 1, 'initial upsert';

  SELECT o.id, ol.id INTO v_order_id, v_line_id
  FROM orders o JOIN order_lines ol ON ol.order_id = o.id
  WHERE o.user_id = owner_id AND o.platform_order_id = 'NAVER-ORD-1' AND ol.platform_line_id = 'PO-LINE-1';

  ASSERT (SELECT quantity FROM order_lines WHERE id = v_line_id) = 4, 'quantity stored';
  ASSERT (SELECT unit_price FROM order_lines WHERE id = v_line_id) = 9000, 'unit price stored';

  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'NAVER-ORD-1', 'status', 'paid', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', 'Buyer', 'currency', 'KRW', 'totalAmount', 36000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'PO-LINE-1', 'platformProductId', 'EXT-99', 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Coffee', 'quantity', 4, 'unitPrice', 9000, 'status', 'active'
      ))
    )
  ));
  ASSERT (SELECT quantity FROM order_lines WHERE id = v_line_id) = 4, 'retry idempotent quantity';
  ASSERT (SELECT count(*) FROM product_stock_events WHERE event_type = 'order_fulfillment'
    AND reference_id = v_line_id) = 0, 'paid replay does not fulfill';

  -- Simulate legacy degraded placeholder that the adapter no longer writes.
  UPDATE order_lines SET quantity = 1, unit_price = NULL, platform_product_id = NULL
  WHERE id = v_line_id;

  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'NAVER-ORD-1', 'status', 'paid', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', 'Buyer', 'currency', 'KRW', 'totalAmount', 36000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'PO-LINE-1', 'platformProductId', 'EXT-99', 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Coffee', 'quantity', 4, 'unitPrice', 9000, 'status', 'active'
      ))
    )
  ));
  ASSERT (SELECT quantity FROM order_lines WHERE id = v_line_id) = 4, 'degraded line repaired';
  ASSERT (SELECT unit_price FROM order_lines WHERE id = v_line_id) = 9000, 'unit price repaired';
  ASSERT (SELECT platform_product_id FROM order_lines WHERE id = v_line_id) = 'EXT-99', 'platform product restored';
  ASSERT (SELECT product_id FROM order_lines WHERE id = v_line_id) = v_product_id, 'product_id preserved';

  result := sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'NAVER-ORD-1', 'status', 'shipped', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', 'Buyer', 'currency', 'KRW', 'totalAmount', 36000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'PO-LINE-1', 'platformProductId', 'EXT-99', 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Coffee', 'quantity', 4, 'unitPrice', 9000, 'status', 'active'
      ))
    )
  ));
  ASSERT (result->>'autoFulfillments')::integer = 1, 'shipped auto-fulfills once';

  SELECT count(*) INTO event_count FROM product_stock_events
  WHERE event_type = 'order_fulfillment' AND reference_id = v_line_id;
  ASSERT event_count = 1, 'single fulfillment event';

  PERFORM sync_channel_orders_batch(owner_id, connection_id, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'NAVER-ORD-1', 'status', 'shipped', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', 'Buyer', 'currency', 'KRW', 'totalAmount', 36000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(jsonb_build_object(
        'platformLineId', 'PO-LINE-1', 'platformProductId', 'EXT-99', 'platformVariantId', null,
        'productId', v_product_id, 'title', 'Coffee', 'quantity', 4, 'unitPrice', 9000, 'status', 'active'
      ))
    )
  ));
  ASSERT (SELECT count(*) FROM product_stock_events WHERE event_type = 'order_fulfillment'
    AND reference_id = v_line_id) = 1, 'shipped replay does not double-fulfill';
END $$;

ROLLBACK;
