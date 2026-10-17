-- Local Postgres only:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=11111111-1111-1111-1111-111111111111 -f supabase/tests/stock_op_request_hash.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DELETE FROM stock_op_receipts WHERE reference_id IN (
  '89200000-0000-0000-0000-000000000020',
  '89200000-0000-0000-0000-000000000021',
  '89200000-0000-0000-0000-000000000022',
  '89200000-0000-0000-0000-000000000030'
);

SET LOCAL ROLE authenticated;

INSERT INTO beans(id, user_id, name)
VALUES ('89200000-0000-0000-0000-000000000001', :'owner', 'bulk bean')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products(id, user_id, name, net_weight_grams, bean_id)
VALUES
  ('89200000-0000-0000-0000-000000000010', :'owner', 'product A', 250, '89200000-0000-0000-0000-000000000001'),
  ('89200000-0000-0000-0000-000000000011', :'owner', 'product B', 250, '89200000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO roasted_stock_events(user_id, bean_id, delta_grams, event_type)
VALUES (:'owner', '89200000-0000-0000-0000-000000000001', 1000, 'adjustment');

DELETE FROM product_stock_events WHERE reference_id IN (
  '89200000-0000-0000-0000-000000000020',
  '89200000-0000-0000-0000-000000000021',
  '89200000-0000-0000-0000-000000000022',
  '89200000-0000-0000-0000-000000000030'
);
DELETE FROM roasted_stock_events WHERE reference_id IN (
  '89200000-0000-0000-0000-000000000020',
  '89200000-0000-0000-0000-000000000021',
  '89200000-0000-0000-0000-000000000022',
  '89200000-0000-0000-0000-000000000030'
);
DELETE FROM product_stock_events WHERE product_id = '89200000-0000-0000-0000-000000000099';
DELETE FROM products WHERE id = '89200000-0000-0000-0000-000000000099';

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  op_a uuid := '89200000-0000-0000-0000-000000000020';
  op_b uuid := '89200000-0000-0000-0000-000000000021';
  op_legacy uuid := '89200000-0000-0000-0000-000000000022';
  op_bean uuid := '89200000-0000-0000-0000-000000000030';
  bulk_grams integer;
  units_a integer;
  units_b integer;
BEGIN
  PERFORM public.insert_packaging_op(
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'product_id', '89200000-0000-0000-0000-000000000010',
      'delta_units', 2, 'event_type', 'roast_inbound', 'reference_id', op_a)),
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', -500, 'event_type', 'packaging', 'reference_id', op_a)));

  SELECT sum(delta_grams) INTO bulk_grams
  FROM roasted_stock_events
  WHERE bean_id = '89200000-0000-0000-0000-000000000001' AND event_type = 'packaging';

  SELECT sum(delta_units) INTO units_a FROM product_stock_events WHERE product_id = '89200000-0000-0000-0000-000000000010';
  ASSERT units_a = 2, 'product A units';
  ASSERT bulk_grams = -500, 'bulk packaging grams';

  PERFORM public.insert_packaging_op(
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'product_id', '89200000-0000-0000-0000-000000000010',
      'delta_units', 2, 'event_type', 'roast_inbound', 'reference_id', op_a)),
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', -500, 'event_type', 'packaging', 'reference_id', op_a)));

  SELECT sum(delta_units) INTO units_a FROM product_stock_events WHERE product_id = '89200000-0000-0000-0000-000000000010';
  ASSERT units_a = 2, 'replay must not duplicate product A';

  BEGIN
    PERFORM public.insert_packaging_op(
      jsonb_build_array(jsonb_build_object(
        'user_id', owner_id, 'product_id', '89200000-0000-0000-0000-000000000011',
        'delta_units', 2, 'event_type', 'roast_inbound', 'reference_id', op_a)),
      jsonb_build_array(jsonb_build_object(
        'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
        'delta_grams', -500, 'event_type', 'packaging', 'reference_id', op_a)));
    RAISE EXCEPTION 'expected idempotency_payload_mismatch for product B';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'idempotency_payload_mismatch' OR SQLSTATE <> 'PF892' THEN RAISE; END IF;
  END;

  SELECT coalesce(sum(delta_units), 0) INTO units_b FROM product_stock_events WHERE product_id = '89200000-0000-0000-0000-000000000011';
  ASSERT units_b = 0, 'product B must stay empty after mismatch';

  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type, reference_id)
  VALUES (owner_id, '89200000-0000-0000-0000-000000000010', 1, 'roast_inbound', op_legacy);

  PERFORM public.insert_packaging_op(
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'product_id', '89200000-0000-0000-0000-000000000010',
      'delta_units', 1, 'event_type', 'roast_inbound', 'reference_id', op_legacy)),
    '[]'::jsonb);

  ASSERT EXISTS (SELECT 1 FROM stock_op_receipts WHERE reference_id = op_legacy), 'legacy receipt written';

  BEGIN
    PERFORM public.insert_packaging_op(
      jsonb_build_array(jsonb_build_object(
        'user_id', owner_id, 'product_id', '89200000-0000-0000-0000-000000000011',
        'delta_units', 1, 'event_type', 'roast_inbound', 'reference_id', op_legacy)),
      '[]'::jsonb);
    RAISE EXCEPTION 'legacy mismatch expected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'idempotency_payload_mismatch' OR SQLSTATE <> 'PF892' THEN RAISE; END IF;
  END;

  INSERT INTO products(id, user_id, name, net_weight_grams)
  VALUES ('89200000-0000-0000-0000-000000000099', owner_id, 'repair sku', 200)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (owner_id, '89200000-0000-0000-0000-000000000099', -5, 'adjustment');

  PERFORM public.insert_packaging_op(
    jsonb_build_array(jsonb_build_object(
      'user_id', owner_id, 'product_id', '89200000-0000-0000-0000-000000000099',
      'delta_units', 3, 'event_type', 'roast_inbound', 'reference_id', gen_random_uuid())),
    '[]'::jsonb);

  SELECT sum(delta_units) INTO units_a FROM product_stock_events WHERE product_id = '89200000-0000-0000-0000-000000000099';
  ASSERT units_a = -2, 'corrective inbound allowed when net negative';

  PERFORM public.insert_bean_stock_event(jsonb_build_object(
    'user_id', owner_id,
    'bean_id', '89200000-0000-0000-0000-000000000001',
    'delta_grams', 1000,
    'event_type', 'purchase',
    'reference_id', op_bean,
    'cost_per_kg', 12000));

  PERFORM public.insert_bean_stock_event(jsonb_build_object(
    'user_id', owner_id,
    'bean_id', '89200000-0000-0000-0000-000000000001',
    'delta_grams', 1000,
    'event_type', 'purchase',
    'reference_id', op_bean,
    'cost_per_kg', 12000));

  ASSERT (SELECT count(*) FROM bean_stock_events WHERE reference_id = op_bean) = 1, 'bean replay single row';

  BEGIN
    PERFORM public.insert_bean_stock_event(jsonb_build_object(
      'user_id', owner_id,
      'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', 2000,
      'event_type', 'purchase',
      'reference_id', op_bean,
      'cost_per_kg', 12000));
    RAISE EXCEPTION 'bean mismatch expected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'idempotency_payload_mismatch' OR SQLSTATE <> 'PF892' THEN RAISE; END IF;
  END;

  ASSERT (SELECT sum(delta_grams) FROM bean_stock_events WHERE reference_id = op_bean) = 1000, 'grams unchanged after mismatch';

  ASSERT public.bean_event_request_hash(jsonb_build_object(
      'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', 1000, 'event_type', 'purchase', 'cost_per_kg', 12000))
    <> public.bean_event_request_hash(jsonb_build_object(
      'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', 1000, 'event_type', 'adjustment', 'cost_per_kg', 12000)),
    'event_type affects bean hash';

  ASSERT public.bean_event_request_hash(jsonb_build_object(
      'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', 1000, 'event_type', 'purchase', 'cost_per_kg', 12000))
    <> public.bean_event_request_hash(jsonb_build_object(
      'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', 2000, 'event_type', 'purchase', 'cost_per_kg', 12000)),
    'delta_grams affects bean hash';

  ASSERT public.bean_event_request_hash(jsonb_build_object(
      'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', 1000, 'event_type', 'purchase', 'cost_per_kg', 12000))
    = public.bean_event_request_hash(jsonb_build_object(
      'user_id', owner_id, 'bean_id', '89200000-0000-0000-0000-000000000001',
      'delta_grams', 1000, 'event_type', 'purchase', 'cost_per_kg', 12000.0)),
    'trim_scale cost equivalence';

  ASSERT public.packaging_request_hash(
    jsonb_build_array(
      jsonb_build_object('product_id', '89200000-0000-0000-0000-000000000010', 'delta_units', 1, 'event_type', 'roast_inbound', 'reference_id', op_a),
      jsonb_build_object('product_id', '89200000-0000-0000-0000-000000000011', 'delta_units', 2, 'event_type', 'roast_inbound', 'reference_id', op_a)),
    '[]'::jsonb)
    = public.packaging_request_hash(
    jsonb_build_array(
      jsonb_build_object('product_id', '89200000-0000-0000-0000-000000000011', 'delta_units', 2, 'event_type', 'roast_inbound', 'reference_id', op_a),
      jsonb_build_object('product_id', '89200000-0000-0000-0000-000000000010', 'delta_units', 1, 'event_type', 'roast_inbound', 'reference_id', op_a)),
    '[]'::jsonb),
    'packaging product events sort deterministically';

  ASSERT public.packaging_request_hash(
    jsonb_build_array(
      jsonb_build_object('product_id', '89200000-0000-0000-0000-000000000010', 'delta_units', 1, 'event_type', 'roast_inbound', 'reference_id', op_a)),
    '[]'::jsonb)
    <> public.packaging_request_hash(
    jsonb_build_array(
      jsonb_build_object('product_id', '89200000-0000-0000-0000-000000000010', 'delta_units', 2, 'event_type', 'roast_inbound', 'reference_id', op_a)),
    '[]'::jsonb),
    'packaging delta_units affects hash';

  ASSERT public.packaging_request_hash('[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('bean_id', '89200000-0000-0000-0000-000000000001', 'delta_grams', -500, 'event_type', 'packaging', 'reference_id', op_a)))
    <> public.packaging_request_hash('[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('bean_id', '89200000-0000-0000-0000-000000000001', 'delta_grams', -250, 'event_type', 'packaging', 'reference_id', op_a))),
    'packaging roasted delta_grams affects hash';
END $$;

\echo stock_op_request_hash ok
ROLLBACK;
