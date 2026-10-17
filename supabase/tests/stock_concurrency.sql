-- Local Postgres only: psql "$URL" -v ON_ERROR_STOP=1 -v owner=11111111-1111-1111-1111-111111111111 -f supabase/tests/stock_concurrency.sql
\if :{?setup}
BEGIN;
SELECT set_config('test.owner', :'owner', true);
\if :{?scenario}
\else
SELECT set_config('test.scenario', 'single', false);
\endif
\if :{?fulfill_race}
DELETE FROM order_lines WHERE user_id = :'owner' AND order_id IN (
  '88900000-0000-0000-0000-000000000002', '88900000-0000-0000-0000-000000000003');
DELETE FROM orders WHERE id IN (
  '88900000-0000-0000-0000-000000000002', '88900000-0000-0000-0000-000000000003');
DELETE FROM product_stock_events WHERE product_id = '88900000-0000-0000-0000-000000000001';
DELETE FROM products WHERE id = '88900000-0000-0000-0000-000000000001';
INSERT INTO products(id, user_id, name, net_weight_grams)
VALUES ('88900000-0000-0000-0000-000000000001', :'owner', 'race product', 200);
INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
VALUES (:'owner', '88900000-0000-0000-0000-000000000001', 5, 'roast_inbound');
INSERT INTO orders(id, user_id, platform, platform_order_id, status, ordered_at)
VALUES ('88900000-0000-0000-0000-000000000002', :'owner', 'manual', 'ord-a', 'paid', now()),
       ('88900000-0000-0000-0000-000000000003', :'owner', 'manual', 'ord-b', 'paid', now());
INSERT INTO order_lines(id, user_id, order_id, platform_line_id, product_id, title, quantity)
VALUES ('88900000-0000-0000-0000-000000000004', :'owner', '88900000-0000-0000-0000-000000000002', 'la', '88900000-0000-0000-0000-000000000001', 'Coffee', 4),
       ('88900000-0000-0000-0000-000000000005', :'owner', '88900000-0000-0000-0000-000000000003', 'lb', '88900000-0000-0000-0000-000000000001', 'Coffee', 4);
\elif :{?pack_race}
INSERT INTO beans(id, user_id, name)
VALUES ('89100000-0000-0000-0000-000000000001', :'owner', 'bulk bean')
ON CONFLICT DO NOTHING;
INSERT INTO products(id, user_id, name, net_weight_grams, bean_id)
VALUES ('89100000-0000-0000-0000-000000000002', :'owner', 'pack sku', 250, '89100000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO roasted_stock_events(user_id, bean_id, delta_grams, event_type)
VALUES (:'owner', '89100000-0000-0000-0000-000000000001', 1000, 'adjustment');
\elif :{?roast_race}
DELETE FROM roast_sessions WHERE plan_batch_id = '89100000-0000-0000-0000-000000000012';
DELETE FROM roast_plan_batches WHERE id = '89100000-0000-0000-0000-000000000012';
DELETE FROM roast_day_plans WHERE id = '89100000-0000-0000-0000-000000000011';
DELETE FROM bean_stock_events WHERE bean_id = '89100000-0000-0000-0000-000000000010';
DELETE FROM beans WHERE id = '89100000-0000-0000-0000-000000000010';
INSERT INTO beans(id, user_id, name)
VALUES ('89100000-0000-0000-0000-000000000010', :'owner', 'plan bean');
INSERT INTO roast_day_plans(id, user_id, date)
VALUES ('89100000-0000-0000-0000-000000000011', :'owner', '2099-06-01');
INSERT INTO roast_plan_batches(id, plan_id, bean_id, bean_name, batch_size_kg, target_roasted_kg, yield_pct, status)
VALUES ('89100000-0000-0000-0000-000000000012', '89100000-0000-0000-0000-000000000011',
  '89100000-0000-0000-0000-000000000010', 'plan bean', 1, 3, 1, 'pending');
INSERT INTO bean_stock_events(user_id, bean_id, delta_grams, event_type)
VALUES (:'owner', '89100000-0000-0000-0000-000000000010', 10000, 'purchase');
\elif :{?corrective}
INSERT INTO products(id, user_id, name, net_weight_grams)
VALUES ('88900000-0000-0000-0000-000000000099', :'owner', 'repair sku', 200)
ON CONFLICT DO NOTHING;
INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
VALUES (:'owner', '88900000-0000-0000-0000-000000000099', -5, 'adjustment');
\elif :{?old_client}
DELETE FROM roasted_stock_events
WHERE reference_id = '89100000-0000-0000-0000-000000000012';
DELETE FROM bean_stock_events WHERE reference_id = '89100000-0000-0000-0000-000000000012';
DELETE FROM roast_sessions WHERE plan_batch_id = '89100000-0000-0000-0000-000000000012';
DELETE FROM roast_plan_batches WHERE id = '89100000-0000-0000-0000-000000000012';
DELETE FROM roast_day_plans WHERE id = '89100000-0000-0000-0000-000000000011';
DELETE FROM beans WHERE id = '89100000-0000-0000-0000-000000000010';
INSERT INTO beans(id, user_id, name)
VALUES ('89100000-0000-0000-0000-000000000010', :'owner', 'plan bean');
INSERT INTO roast_day_plans(id, user_id, date)
VALUES ('89100000-0000-0000-0000-000000000011', :'owner', '2099-06-01');
INSERT INTO roast_plan_batches(id, plan_id, bean_id, bean_name, batch_size_kg, target_roasted_kg, yield_pct, status)
VALUES ('89100000-0000-0000-0000-000000000012', '89100000-0000-0000-0000-000000000011',
  '89100000-0000-0000-0000-000000000010', 'plan bean', 1, 3, 1, 'pending');
INSERT INTO bean_stock_events(user_id, bean_id, delta_grams, event_type)
VALUES (:'owner', '89100000-0000-0000-0000-000000000010', 10000, 'purchase');
\if :{?three_sessions}
INSERT INTO roast_sessions(id, user_id, plan_batch_id, bean_id, weight_grams, status, roasted_at)
VALUES
  ('89100000-0000-0000-0000-000000000031', :'owner', '89100000-0000-0000-0000-000000000012',
    '89100000-0000-0000-0000-000000000010', 1000, 'completed', now()),
  ('89100000-0000-0000-0000-000000000032', :'owner', '89100000-0000-0000-0000-000000000012',
    '89100000-0000-0000-0000-000000000010', 1000, 'completed', now()),
  ('89100000-0000-0000-0000-000000000033', :'owner', '89100000-0000-0000-0000-000000000012',
    '89100000-0000-0000-0000-000000000010', 1000, 'completed', now());
\else
INSERT INTO roast_sessions(id, user_id, plan_batch_id, bean_id, weight_grams, status, roasted_at)
VALUES ('89100000-0000-0000-0000-000000000030', :'owner', '89100000-0000-0000-0000-000000000012',
  '89100000-0000-0000-0000-000000000010', 1000, 'completed', now());
\endif
\elif :{?ef_batch_race}
DELETE FROM order_lines WHERE id IN ('88900000-0000-0000-0000-000000000014', '88900000-0000-0000-0000-000000000015');
DELETE FROM orders WHERE id IN ('88900000-0000-0000-0000-000000000012', '88900000-0000-0000-0000-000000000013');
DELETE FROM product_stock_events WHERE product_id = '88900000-0000-0000-0000-000000000010';
DELETE FROM products WHERE id = '88900000-0000-0000-0000-000000000010';
INSERT INTO products(id, user_id, name, net_weight_grams)
VALUES ('88900000-0000-0000-0000-000000000010', :'owner', 'ef batch sku', 200);
INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
VALUES (:'owner', '88900000-0000-0000-0000-000000000010', 5, 'roast_inbound');
INSERT INTO orders(id, user_id, platform, platform_order_id, status, ordered_at)
VALUES ('88900000-0000-0000-0000-000000000012', :'owner', 'manual', 'ef-a', 'paid', now()),
       ('88900000-0000-0000-0000-000000000013', :'owner', 'manual', 'ef-b', 'paid', now());
INSERT INTO order_lines(id, user_id, order_id, platform_line_id, product_id, title, quantity)
VALUES ('88900000-0000-0000-0000-000000000014', :'owner', '88900000-0000-0000-0000-000000000012', 'ela', '88900000-0000-0000-0000-000000000010', 'Coffee', 4),
       ('88900000-0000-0000-0000-000000000015', :'owner', '88900000-0000-0000-0000-000000000013', 'elb', '88900000-0000-0000-0000-000000000010', 'Coffee', 4);
\elif :{?fulfill_ef_race}
DELETE FROM order_lines WHERE id = '88900000-0000-0000-0000-000000000016';
DELETE FROM orders WHERE id = '88900000-0000-0000-0000-000000000014';
DELETE FROM product_stock_events WHERE product_id = '88900000-0000-0000-0000-000000000011';
DELETE FROM products WHERE id = '88900000-0000-0000-0000-000000000011';
INSERT INTO products(id, user_id, name, net_weight_grams)
VALUES ('88900000-0000-0000-0000-000000000011', :'owner', 'mixed path sku', 200);
INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
VALUES (:'owner', '88900000-0000-0000-0000-000000000011', 5, 'roast_inbound');
INSERT INTO orders(id, user_id, platform, platform_order_id, status, ordered_at)
VALUES ('88900000-0000-0000-0000-000000000014', :'owner', 'manual', 'mix-a', 'paid', now());
INSERT INTO order_lines(id, user_id, order_id, platform_line_id, product_id, title, quantity)
VALUES ('88900000-0000-0000-0000-000000000016', :'owner', '88900000-0000-0000-0000-000000000014', 'mla', '88900000-0000-0000-0000-000000000011', 'Coffee', 4);
\elif :{?rollback_fail}
DELETE FROM product_stock_events WHERE product_id = '88900000-0000-0000-0000-000000000088';
DELETE FROM products WHERE id = '88900000-0000-0000-0000-000000000088';
INSERT INTO products(id, user_id, name, net_weight_grams)
VALUES ('88900000-0000-0000-0000-000000000088', :'owner', 'rollback sku', 200);
INSERT INTO product_stock_events(user_id, product_id, delta_units, event_type)
VALUES (:'owner', '88900000-0000-0000-0000-000000000088', 2, 'roast_inbound');
\endif
COMMIT;
\elif :{?call}
BEGIN;
SELECT set_config('request.jwt.claim.sub', :'owner', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
\if :{?fulfill_a}
SELECT public.fulfill_order('88900000-0000-0000-0000-000000000002');
\elif :{?fulfill_b}
SELECT public.fulfill_order('88900000-0000-0000-0000-000000000003');
\elif :{?pack_a}
SELECT public.insert_packaging_op(
  jsonb_build_array(jsonb_build_object(
    'user_id', :'owner', 'product_id', '89100000-0000-0000-0000-000000000002',
    'delta_units', 3, 'event_type', 'roast_inbound', 'reference_id', '89100000-0000-0000-0000-000000000020')),
  jsonb_build_array(jsonb_build_object(
    'user_id', :'owner', 'bean_id', '89100000-0000-0000-0000-000000000001',
    'delta_grams', -750, 'event_type', 'packaging', 'reference_id', '89100000-0000-0000-0000-000000000020')));
\elif :{?pack_b}
SELECT public.insert_packaging_op(
  jsonb_build_array(jsonb_build_object(
    'user_id', :'owner', 'product_id', '89100000-0000-0000-0000-000000000002',
    'delta_units', 3, 'event_type', 'roast_inbound', 'reference_id', '89100000-0000-0000-0000-000000000021')),
  jsonb_build_array(jsonb_build_object(
    'user_id', :'owner', 'bean_id', '89100000-0000-0000-0000-000000000001',
    'delta_grams', -750, 'event_type', 'packaging', 'reference_id', '89100000-0000-0000-0000-000000000021')));
\elif :{?save_session}
SELECT public.save_roast_op(
  jsonb_build_object('id', '89100000-0000-0000-0000-000000000030', 'user_id', :'owner',
    'plan_batch_id', '89100000-0000-0000-0000-000000000012',
    'bean_id', '89100000-0000-0000-0000-000000000010',
    'weight_grams', 1000, 'roasted_at', now(), 'status', 'completed',
    'expected_plan_bean_id', '89100000-0000-0000-0000-000000000010'),
  true, 1000, 0, false);
\elif :{?complete_batch}
SELECT public.complete_plan_batch('89100000-0000-0000-0000-000000000012', true);
\elif :{?repair_inbound}
SELECT public.insert_product_stock_events_batch(jsonb_build_array(jsonb_build_object(
  'user_id', :'owner', 'product_id', '88900000-0000-0000-0000-000000000099',
  'delta_units', 3, 'event_type', 'adjustment')));
\elif :{?retry_fulfill}
SELECT public.fulfill_order('88900000-0000-0000-0000-000000000002');
\elif :{?legacy_complete}
SELECT public.insert_stock_events_batch(
  jsonb_build_array(jsonb_build_object(
    'user_id', :'owner', 'bean_id', '89100000-0000-0000-0000-000000000010',
    'delta_grams', -3000, 'event_type', 'roast', 'reference_id', '89100000-0000-0000-0000-000000000012')),
  jsonb_build_array(jsonb_build_object(
    'user_id', :'owner', 'bean_id', '89100000-0000-0000-0000-000000000010',
    'delta_grams', 2460, 'event_type', 'roast_inbound', 'reference_id', '89100000-0000-0000-0000-000000000012',
    'is_estimate', true)));
\elif :{?ef_batch_a}
SELECT public.insert_product_stock_events_batch(jsonb_build_array(jsonb_build_object(
  'user_id', :'owner', 'product_id', '88900000-0000-0000-0000-000000000010',
  'delta_units', -4, 'event_type', 'order_fulfillment', 'reference_id', '88900000-0000-0000-0000-000000000014')));
\elif :{?ef_batch_b}
SELECT public.insert_product_stock_events_batch(jsonb_build_array(jsonb_build_object(
  'user_id', :'owner', 'product_id', '88900000-0000-0000-0000-000000000010',
  'delta_units', -4, 'event_type', 'order_fulfillment', 'reference_id', '88900000-0000-0000-0000-000000000015')));
\elif :{?fulfill_mix}
SELECT public.fulfill_order('88900000-0000-0000-0000-000000000014');
\elif :{?ef_batch_mix}
SELECT public.insert_product_stock_events_batch(jsonb_build_array(jsonb_build_object(
  'user_id', :'owner', 'product_id', '88900000-0000-0000-0000-000000000011',
  'delta_units', -4, 'event_type', 'order_fulfillment', 'reference_id', '88900000-0000-0000-0000-000000000016')));
\elif :{?rollback_bad}
SELECT public.insert_product_stock_events_batch(jsonb_build_array(jsonb_build_object(
  'user_id', :'owner', 'product_id', '88900000-0000-0000-0000-000000000088',
  'delta_units', -5, 'event_type', 'adjustment')));
\endif
\echo ready
\if :{?hold}
SELECT pg_sleep(1);
\endif
COMMIT;
\elif :{?verify}
\if :{?fulfill_race}
SELECT sum(delta_units) AS balance FROM product_stock_events
WHERE product_id = '88900000-0000-0000-0000-000000000001';
SELECT count(*) AS fulfillment_events FROM product_stock_events
WHERE product_id = '88900000-0000-0000-0000-000000000001' AND event_type = 'order_fulfillment';
\elif :{?pack_race}
SELECT sum(delta_grams) AS bulk_balance FROM roasted_stock_events
WHERE bean_id = '89100000-0000-0000-0000-000000000001';
\elif :{?roast_race}
SELECT sum(delta_grams) AS green_deducted FROM bean_stock_events
WHERE bean_id = '89100000-0000-0000-0000-000000000010' AND event_type = 'roast';
SELECT status FROM roast_plan_batches WHERE id = '89100000-0000-0000-0000-000000000012';
\elif :{?corrective}
SELECT sum(delta_units) AS balance FROM product_stock_events
WHERE product_id = '88900000-0000-0000-0000-000000000099';
\elif :{?old_client}
SELECT COALESCE(sum(delta_grams), 0) FROM bean_stock_events
WHERE bean_id = '89100000-0000-0000-0000-000000000010' AND event_type = 'roast'
  AND reference_id = '89100000-0000-0000-0000-000000000012';
SELECT COALESCE(sum(delta_grams), 0) FROM roasted_stock_events
WHERE bean_id = '89100000-0000-0000-0000-000000000010'
  AND reference_id = '89100000-0000-0000-0000-000000000012' AND event_type = 'roast_inbound';
\elif :{?ef_batch_race}
SELECT sum(delta_units) FROM product_stock_events
WHERE product_id = '88900000-0000-0000-0000-000000000010';
SELECT count(*) FROM product_stock_events
WHERE product_id = '88900000-0000-0000-0000-000000000010' AND event_type = 'order_fulfillment';
\elif :{?fulfill_ef_race}
SELECT sum(delta_units) FROM product_stock_events
WHERE product_id = '88900000-0000-0000-0000-000000000011';
SELECT count(*) FROM product_stock_events
WHERE product_id = '88900000-0000-0000-0000-000000000011' AND event_type = 'order_fulfillment';
\elif :{?rollback_fail}
SELECT sum(delta_units) FROM product_stock_events
WHERE product_id = '88900000-0000-0000-0000-000000000088';
\endif
\elif :{?teardown}
DELETE FROM roasted_stock_events WHERE reference_id = '89100000-0000-0000-0000-000000000012';
DELETE FROM bean_stock_events WHERE reference_id = '89100000-0000-0000-0000-000000000012';
DELETE FROM roast_sessions WHERE plan_batch_id = '89100000-0000-0000-0000-000000000012'
   OR id IN (
     '89100000-0000-0000-0000-000000000030',
     '89100000-0000-0000-0000-000000000031',
     '89100000-0000-0000-0000-000000000032',
     '89100000-0000-0000-0000-000000000033'
   );
DELETE FROM roast_plan_batches WHERE id = '89100000-0000-0000-0000-000000000012';
DELETE FROM roast_day_plans WHERE id = '89100000-0000-0000-0000-000000000011';
DELETE FROM bean_stock_events WHERE bean_id = '89100000-0000-0000-0000-000000000010';
DELETE FROM beans WHERE id = '89100000-0000-0000-0000-000000000010';
DELETE FROM roasted_stock_events WHERE bean_id = '89100000-0000-0000-0000-000000000001';
DELETE FROM product_stock_events WHERE product_id::text LIKE '88900000-0000-0000-0000-0000000000%'
   OR product_id::text LIKE '89100000-0000-0000-0000-0000000000%';
DELETE FROM order_lines WHERE id::text LIKE '88900000-0000-0000-0000-0000000000%';
DELETE FROM orders WHERE id::text LIKE '88900000-0000-0000-0000-0000000000%';
DELETE FROM products WHERE id::text LIKE '88900000-0000-0000-0000-0000000000%'
   OR id::text LIKE '89100000-0000-0000-0000-0000000000%';
\else
\warn 'use setup, call, verify, or teardown with scenario flags'
\quit 1
\endif
