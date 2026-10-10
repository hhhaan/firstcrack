-- Run the paired sessions with channel_orders_concurrent.py on the local stack.
\if :{?setup}
BEGIN;
INSERT INTO public.sales_channel_connections(id, user_id, platform, shop_identifier, status, auto_fulfill_on_shipped)
VALUES ('73600000-3000-0000-0000-000000000001', :'owner', 'shopify', '736-concurrent', 'active', true);
INSERT INTO public.products(id, user_id, name, net_weight_grams)
VALUES ('73600000-3000-0000-0000-000000000002', :'owner', '736 concurrent', 200);
INSERT INTO public.product_stock_events(user_id, product_id, delta_units, event_type)
VALUES (:'owner', '73600000-3000-0000-0000-000000000002', 10, 'roast_inbound');
SELECT :'scenario' <> 'new_retry' AS existing \gset
\if :existing
INSERT INTO public.orders(id, user_id, connection_id, platform, platform_order_id, status, ordered_at)
VALUES ('73600000-3000-0000-0000-000000000003', :'owner',
  '73600000-3000-0000-0000-000000000001', 'shopify', '736-concurrent', 'paid', now());
INSERT INTO public.order_lines(id, user_id, order_id, platform_line_id, product_id, title, quantity)
VALUES ('73600000-3000-0000-0000-000000000004', :'owner',
  '73600000-3000-0000-0000-000000000003', 'line', '73600000-3000-0000-0000-000000000002', 'Coffee', 2);
\endif
COMMIT;
\elif :{?call}
BEGIN;
SET LOCAL ROLE service_role;
SELECT :'op' = 'sync' AS sync, :'op' = 'fulfill' AS fulfill \gset
\if :sync
SELECT public.sync_channel_orders_batch(:'owner', '73600000-3000-0000-0000-000000000001',
  '[{"platformOrderId":"736-concurrent","status":"shipped","orderedAt":"2026-10-10T00:00:00Z",
    "currency":"KRW","lines":[{"platformLineId":"line","productId":"73600000-3000-0000-0000-000000000002",
    "title":"Coffee","quantity":2,"status":"active"}]}]');
\elif :fulfill
SELECT public.fulfill_order(id) FROM public.orders WHERE platform_order_id = '736-concurrent';
\else
SELECT public.cancel_order(id) FROM public.orders WHERE platform_order_id = '736-concurrent';
\endif
\echo ready
\if :{?hold}
SELECT pg_sleep(1);
\endif
COMMIT;
\elif :{?verify}
SELECT set_config('test.scenario', :'scenario', false);
DO $$
DECLARE
  v_order_id uuid;
  v_cancel boolean := current_setting('test.scenario') IN ('sync_cancel', 'cancel_sync');
  v_first_cancel boolean := current_setting('test.scenario') = 'cancel_sync';
BEGIN
  SELECT id INTO STRICT v_order_id FROM public.orders WHERE platform_order_id = '736-concurrent';
  ASSERT (SELECT count(*) FROM public.orders WHERE platform_order_id = '736-concurrent') = 1, 'duplicate order';
  ASSERT (SELECT count(*) FROM public.order_lines WHERE order_id = v_order_id) = 1, 'duplicate line';
  ASSERT (SELECT count(*) FROM public.product_stock_events WHERE product_id = '73600000-3000-0000-0000-000000000002'
    AND event_type = 'order_fulfillment') = CASE WHEN v_first_cancel THEN 0 ELSE 1 END, 'duplicate or terminal deduction';
  ASSERT (SELECT count(*) FROM public.product_stock_events WHERE product_id = '73600000-3000-0000-0000-000000000002'
    AND event_type = 'order_cancel') = CASE WHEN v_cancel AND NOT v_first_cancel THEN 1 ELSE 0 END, 'phantom restore';
  ASSERT (SELECT sum(delta_units) FROM public.product_stock_events WHERE product_id = '73600000-3000-0000-0000-000000000002')
    = CASE WHEN v_cancel THEN 10 ELSE 8 END, 'wrong stock balance';
  ASSERT (SELECT status FROM public.orders WHERE id = v_order_id) = CASE WHEN v_cancel THEN 'cancelled' ELSE 'shipped' END,
    'status regression';
  ASSERT (SELECT fulfilled_at IS NOT NULL FROM public.orders WHERE id = v_order_id) = NOT v_first_cancel,
    'fake fulfillment';
END $$;
DELETE FROM public.orders WHERE platform_order_id = '736-concurrent';
DELETE FROM public.products WHERE id = '73600000-3000-0000-0000-000000000002';
DELETE FROM public.sales_channel_connections WHERE id = '73600000-3000-0000-0000-000000000001';
\else
\warn 'use setup, call, or verify'
\quit 1
\endif
