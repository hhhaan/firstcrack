-- Idempotent create_order (#840). Usage:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -v owner=<profile uuid> -f supabase/tests/create_order_idempotent.sql
BEGIN;

SELECT set_config('test.owner', :'owner', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  product_id uuid := gen_random_uuid();
  platform_key text := 'manual-idem-fixture-1';
  order_json jsonb;
  lines_json jsonb;
  id_first uuid;
  id_retry uuid;
  id_other uuid;
  line_count integer;
  order_count integer;
BEGIN
  INSERT INTO public.products(id, user_id, name, sku, net_weight_grams)
  VALUES (product_id, owner_id, 'Idem fixture', 'IDEM-1', 200);

  order_json := jsonb_build_object(
    'user_id', owner_id,
    'platform', 'manual',
    'platform_order_id', platform_key,
    'status', 'paid'
  );
  lines_json := jsonb_build_array(
    jsonb_build_object(
      'platform_line_id', 'line-0',
      'product_id', product_id,
      'title', 'Coffee',
      'quantity', 2
    ),
    jsonb_build_object(
      'platform_line_id', 'line-1',
      'product_id', product_id,
      'title', 'Coffee',
      'quantity', 1
    )
  );

  id_first := public.create_order(order_json, lines_json);
  id_retry := public.create_order(order_json, lines_json);

  ASSERT id_first IS NOT NULL, 'first call returns id';
  ASSERT id_retry = id_first, 'same platform_order_id returns same id';

  SELECT count(*) INTO order_count
  FROM public.orders
  WHERE user_id = owner_id AND platform = 'manual' AND platform_order_id = platform_key;
  ASSERT order_count = 1, 'one order row for duplicate key';

  SELECT count(*) INTO line_count FROM public.order_lines WHERE order_id = id_first;
  ASSERT line_count = 2, 'line count matches first call only';

  order_json := jsonb_build_object(
    'user_id', owner_id,
    'platform', 'manual',
    'platform_order_id', 'manual-idem-fixture-2',
    'status', 'paid'
  );
  id_other := public.create_order(order_json, lines_json);
  ASSERT id_other <> id_first, 'different keys create separate orders';

  BEGIN
    PERFORM public.create_order(
      order_json,
      jsonb_build_array(jsonb_build_object('product_id', product_id, 'title', 'x', 'quantity', 0))
    );
    RAISE EXCEPTION 'expected order_line_quantity_invalid';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END $$;

ROLLBACK;
