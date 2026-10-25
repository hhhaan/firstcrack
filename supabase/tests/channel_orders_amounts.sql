-- Local database fixture. Usage:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=<profile uuid> -f supabase/tests/channel_orders_amounts.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  naver_conn uuid := gen_random_uuid();
  cafe24_conn uuid := gen_random_uuid();
  v_order_id uuid;
  v_total numeric;
  v_line_count integer;
BEGIN
  INSERT INTO sales_channel_connections(id, user_id, platform, shop_identifier, status)
  VALUES
    (naver_conn, owner_id, 'naver', 'amounts-naver-fixture', 'active'),
    (cafe24_conn, owner_id, 'cafe24', 'amounts-cafe24-fixture', 'active');

  SET LOCAL ROLE service_role;

  -- 1) Naver: 2 lines 10k+20k, total 30k → partial resend line 2 cancelled, header total 20k → still 30k, 2 lines.
  PERFORM sync_channel_orders_batch(owner_id, naver_conn, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'naver-partial-1', 'status', 'paid', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 30000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId', 'n-line-1', 'title', 'A', 'quantity', 1, 'unitPrice', 10000, 'status', 'active'),
        jsonb_build_object('platformLineId', 'n-line-2', 'title', 'B', 'quantity', 1, 'unitPrice', 20000, 'status', 'active')
      )
    )
  ));

  PERFORM sync_channel_orders_batch(owner_id, naver_conn, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'naver-partial-1', 'status', 'paid', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 20000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId', 'n-line-2', 'title', 'B', 'quantity', 1, 'unitPrice', 20000, 'status', 'cancelled')
      )
    )
  ));

  SELECT id, total_amount INTO v_order_id, v_total
  FROM orders WHERE user_id = owner_id AND platform = 'naver' AND platform_order_id = 'naver-partial-1';
  ASSERT v_total = 30000, 'naver partial cancel keeps original total';
  SELECT count(*) INTO v_line_count FROM order_lines WHERE order_id = v_order_id;
  ASSERT v_line_count = 2, 'naver partial resend keeps both lines';

  -- 2) Same order, totalAmount null → 30k.
  PERFORM sync_channel_orders_batch(owner_id, naver_conn, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'naver-partial-1', 'status', 'paid', 'orderedAt', '2026-10-10T01:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', null, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId', 'n-line-2', 'title', 'B', 'quantity', 1, 'unitPrice', 20000, 'status', 'cancelled')
      )
    )
  ));
  SELECT total_amount INTO v_total FROM orders WHERE id = v_order_id;
  ASSERT v_total = 30000, 'naver null total preserves original total';

  -- 3) Cafe24: 50k → null resend → 50k; then 60k → 60k.
  PERFORM sync_channel_orders_batch(owner_id, cafe24_conn, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'cafe24-amt-1', 'status', 'paid', 'orderedAt', '2026-10-10T02:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 50000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId', 'c-line-1', 'title', 'Item', 'quantity', 1, 'unitPrice', 50000, 'status', 'active')
      )
    )
  ));
  PERFORM sync_channel_orders_batch(owner_id, cafe24_conn, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'cafe24-amt-1', 'status', 'paid', 'orderedAt', '2026-10-10T02:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', null, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId', 'c-line-1', 'title', 'Item', 'quantity', 1, 'unitPrice', 50000, 'status', 'active')
      )
    )
  ));
  SELECT total_amount INTO v_total FROM orders
  WHERE user_id = owner_id AND platform = 'cafe24' AND platform_order_id = 'cafe24-amt-1';
  ASSERT v_total = 50000, 'cafe24 null total preserves existing total';

  PERFORM sync_channel_orders_batch(owner_id, cafe24_conn, jsonb_build_array(
    jsonb_build_object(
      'platformOrderId', 'cafe24-amt-1', 'status', 'paid', 'orderedAt', '2026-10-10T02:00:00Z',
      'buyerName', null, 'currency', 'KRW', 'totalAmount', 60000, 'raw', '{}'::jsonb,
      'lines', jsonb_build_array(
        jsonb_build_object('platformLineId', 'c-line-1', 'title', 'Item', 'quantity', 1, 'unitPrice', 50000, 'status', 'active')
      )
    )
  ));
  SELECT total_amount INTO v_total FROM orders
  WHERE user_id = owner_id AND platform = 'cafe24' AND platform_order_id = 'cafe24-amt-1';
  ASSERT v_total = 60000, 'cafe24 non-null total updates';

  -- 4) Manual order: NULL total_amount is allowed (trigger skips manual).
  INSERT INTO orders(user_id, platform, platform_order_id, status, ordered_at, total_amount)
  VALUES (owner_id, 'manual', 'manual-null-total', 'paid', now(), 12345)
  RETURNING id INTO v_order_id;
  UPDATE orders SET total_amount = NULL WHERE id = v_order_id;
  SELECT total_amount INTO v_total FROM orders WHERE id = v_order_id;
  ASSERT v_total IS NULL, 'manual platform allows null total_amount';

  -- 5) order_sync_runs external_event_id uniqueness.
  BEGIN
    INSERT INTO order_sync_runs(connection_id, user_id, trigger, status, external_event_id)
    VALUES (cafe24_conn, owner_id, 'webhook', 'success', 'fixture-dup-key');
    INSERT INTO order_sync_runs(connection_id, user_id, trigger, status, external_event_id)
    VALUES (cafe24_conn, owner_id, 'webhook', 'success', 'fixture-dup-key');
    RAISE EXCEPTION 'expected unique_violation on duplicate external_event_id';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

ROLLBACK;
