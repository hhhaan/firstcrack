-- Local fixture: psql <local DB> -v ON_ERROR_STOP=1 -v owner=<profile uuid> -f this-file
BEGIN;
SELECT set_config('test.owner', :'owner', true);
DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  cafe24_connection_id uuid := gen_random_uuid();
  product_id uuid := gen_random_uuid();
  cafe24_payload jsonb;
  result jsonb;
BEGIN
  INSERT INTO products(id,user_id,name,sku,net_weight_grams)
  VALUES(product_id,owner_id,'Cafe24 replay fixture','CAFE24-REPLAY',200);
  INSERT INTO product_stock_events(user_id,product_id,delta_units,event_type)
  VALUES(owner_id,product_id,10,'roast_inbound');
  SET LOCAL ROLE service_role;
  -- Cafe24 has no delivery id: the exact same shipped snapshot must keep one
  -- order, one line, and one deduction across two webhook RPC calls (#859).
  INSERT INTO sales_channel_connections(id,user_id,platform,shop_identifier,status,auto_fulfill_on_shipped)
  VALUES(cafe24_connection_id,owner_id,'cafe24','cafe24-replay-fixture','active',true);
  cafe24_payload := jsonb_build_array(jsonb_build_object(
    'platformOrderId','cafe24-replay','status','shipped','orderedAt','2026-10-10T00:00:00Z',
    'lines',jsonb_build_array(jsonb_build_object(
      'platformLineId','cafe24-line','productId',product_id,'title','Coffee',
      'quantity',2,'status','active'
    ))
  ));
  result := sync_channel_orders_batch(owner_id,cafe24_connection_id,cafe24_payload);
  ASSERT result->>'autoFulfillments'='1', 'first Cafe24 delivery deducts once';
  result := sync_channel_orders_batch(owner_id,cafe24_connection_id,cafe24_payload);
  ASSERT result->>'autoFulfillments'='0', 'Cafe24 replay has no further deduction';
  ASSERT (SELECT count(*) FROM orders WHERE connection_id=cafe24_connection_id)=1,
    'Cafe24 replay keeps one order';
  ASSERT (SELECT count(*) FROM order_lines ol JOIN orders o ON o.id=ol.order_id
    WHERE o.connection_id=cafe24_connection_id)=1, 'Cafe24 replay keeps one line';
  ASSERT (SELECT count(*)=1 AND sum(pse.delta_units)=-2 FROM product_stock_events pse
    JOIN order_lines ol ON ol.id=pse.reference_id JOIN orders o ON o.id=ol.order_id
    WHERE o.connection_id=cafe24_connection_id AND pse.event_type='order_fulfillment'),
    'Cafe24 replay keeps one stock deduction';

  RESET ROLE;
END $$;
ROLLBACK;
