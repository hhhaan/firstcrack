-- Local seeded database only. Supply two existing writable profile UUIDs:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=... -v other_owner=... -f supabase/tests/create_order_idempotent.sql
-- Run as local postgres; this tests the RPC contract, not authenticated RLS policies.
-- Same key + same payload returns the existing order. A different payload errors
-- and leaves the stored row unchanged. Another workspace may reuse the key.
BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('test.other_owner', :'other_owner', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);
DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  other_id uuid := current_setting('test.other_owner')::uuid;
  product_id uuid;
  payload jsonb;
  lines jsonb;
  order_id uuid;
  again_id uuid;
  other_order_id uuid;
BEGIN
  INSERT INTO products (user_id, name, net_weight_grams)
  VALUES (owner_id, 'create-order-idem', 200)
  RETURNING id INTO product_id;

  payload := jsonb_build_object(
    'user_id', owner_id,
    'platform', 'manual',
    'platform_order_id', 'manual-test-key',
    'status', 'paid',
    'ordered_at', '2099-01-01T00:00:00Z',
    'buyer_name', 'Ada'
  );
  lines := jsonb_build_array(jsonb_build_object(
    'platform_line_id', 'line-0',
    'product_id', product_id,
    'title', 'Bag',
    'quantity', 2,
    'unit_price', 12.5
  ));

  order_id := create_order(payload, lines);
  again_id := create_order(payload, lines);
  ASSERT again_id = order_id, 'same payload returns the existing order';
  ASSERT (SELECT count(*) FROM orders WHERE user_id = owner_id AND platform_order_id = 'manual-test-key') = 1;
  ASSERT (SELECT count(*) FROM order_lines WHERE order_id = order_id) = 1, 'retry must not insert lines again';

  -- Same instant, different offset spelling.
  again_id := create_order(payload || jsonb_build_object('ordered_at', '2099-01-01T00:00:00+00'), lines);
  ASSERT again_id = order_id, 'timestamptz equality, not text equality';

  BEGIN
    PERFORM create_order(payload || jsonb_build_object('buyer_name', 'Grace'), lines);
    RAISE EXCEPTION 'test: mismatched buyer accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'order_key_payload_mismatch' THEN RAISE; END IF;
  END;
  ASSERT (SELECT buyer_name FROM orders WHERE id = order_id) = 'Ada';
  ASSERT (SELECT count(*) FROM orders WHERE platform_order_id = 'manual-test-key') = 1;

  BEGIN
    PERFORM create_order(payload, jsonb_build_array(jsonb_build_object(
      'platform_line_id', 'line-0',
      'product_id', product_id,
      'title', 'Bag',
      'quantity', 9,
      'unit_price', 12.5
    )));
    RAISE EXCEPTION 'test: mismatched quantity accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'order_key_payload_mismatch' THEN RAISE; END IF;
  END;
  ASSERT (SELECT quantity FROM order_lines WHERE order_id = order_id) = 2;

  again_id := create_order(payload || jsonb_build_object('platform_order_id', 'manual-test-key-2'), lines);
  ASSERT again_id <> order_id;
  ASSERT (SELECT count(*) FROM orders WHERE user_id = owner_id AND platform = 'manual' AND platform_order_id LIKE 'manual-test-key%') = 2;

  PERFORM set_config('request.jwt.claim.sub', other_id::text, true);
  other_order_id := create_order(jsonb_build_object(
    'user_id', other_id,
    'platform', 'manual',
    'platform_order_id', 'manual-test-key',
    'status', 'paid',
    'ordered_at', '2099-01-01T00:00:00Z',
    'buyer_name', 'Ada'
  ), lines);
  ASSERT other_order_id <> order_id, 'another workspace may reuse the key';

  BEGIN
    PERFORM create_order(payload, lines);
    RAISE EXCEPTION 'test: foreign workspace accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'workspace access denied' THEN RAISE; END IF;
  END;
  ASSERT (SELECT count(*) FROM orders WHERE user_id = owner_id AND platform_order_id = 'manual-test-key') = 1;

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  BEGIN
    PERFORM create_order(payload || jsonb_build_object('platform_order_id', 'manual-empty'), '[]'::jsonb);
    RAISE EXCEPTION 'test: empty lines accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'order_lines_required' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_order(
      payload || jsonb_build_object('platform_order_id', 'manual-bad-qty'),
      jsonb_build_array(jsonb_build_object(
        'platform_line_id', 'line-0',
        'product_id', product_id,
        'title', 'Bag',
        'quantity', 0
      ))
    );
    RAISE EXCEPTION 'test: zero quantity accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'order_line_quantity_invalid' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM orders WHERE platform_order_id IN ('manual-empty', 'manual-bad-qty'));
END;
$$;
ROLLBACK;
