CREATE OR REPLACE FUNCTION public.channel_try_timestamptz(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
STRICT
SET search_path = public
AS $function$
BEGIN
  RETURN p_value::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.channel_try_timestamptz(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.channel_try_timestamptz(text) TO service_role;

CREATE OR REPLACE FUNCTION public.channel_try_integer(p_value text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public
AS $function$
BEGIN
  RETURN p_value::integer;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.channel_try_integer(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.channel_try_integer(text) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_channel_orders_batch(p_user_id uuid, p_connection_id uuid, p_orders jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_platform text;
  v_auto_fulfill boolean;
  v_wave integer;
  v_max_wave integer;
  v_events jsonb;
  v_stock_result jsonb;
  v_wave_skips jsonb;
  v_skips jsonb := '[]'::jsonb;
  v_upserted integer := 0;
  v_cancelled integer := 0;
  v_fulfilled integer := 0;
BEGIN
  IF jsonb_typeof(p_orders) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_orders_payload' USING ERRCODE = '22023';
  END IF;
  SELECT c.platform, c.auto_fulfill_on_shipped INTO v_platform, v_auto_fulfill
  FROM sales_channel_connections c WHERE c.id = p_connection_id AND c.user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'channel_connection_not_found' USING ERRCODE = 'no_data_found'; END IF;

  CREATE TEMP TABLE _channel_batch_input ON COMMIT DROP AS
  SELECT value payload, value->>'platformOrderId' platform_order_id,
         row_number() OVER (PARTITION BY value->>'platformOrderId' ORDER BY ordinality)::integer wave
  FROM jsonb_array_elements(p_orders) WITH ORDINALITY;
  IF EXISTS (
    SELECT 1 FROM _channel_batch_input i
    WHERE NULLIF(i.platform_order_id, '') IS NULL
       OR i.payload->>'status' IS NULL
       OR i.payload->>'status' NOT IN ('pending','paid','preparing','shipped','delivered','cancelled','refunded')
       OR jsonb_typeof(i.payload->'lines') IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(i.payload->'lines') line
         WHERE NULLIF(line->>'platformLineId', '') IS NULL
            OR line->>'status' IS NULL OR line->>'status' NOT IN ('active','cancelled','refunded')
            OR line->>'title' IS NULL
            OR channel_try_integer(line->>'quantity') IS NULL OR channel_try_integer(line->>'quantity') <= 0)
  ) THEN RAISE EXCEPTION 'invalid_order_payload' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||v_platform||':'||i.platform_order_id, 0))
  FROM (SELECT DISTINCT platform_order_id FROM _channel_batch_input) i ORDER BY i.platform_order_id;
  -- Match manual fulfill/cancel lock order, then lock every candidate product once so
  -- overlapping batches cannot both pass the post-insert stock balance check.
  PERFORM 1 FROM orders o JOIN _channel_batch_input i
    ON o.user_id=p_user_id AND o.platform=v_platform AND o.platform_order_id=i.platform_order_id
  ORDER BY o.id FOR UPDATE;
  PERFORM 1 FROM order_lines ol JOIN orders o ON o.id=ol.order_id JOIN _channel_batch_input i
    ON o.user_id=p_user_id AND o.platform=v_platform AND o.platform_order_id=i.platform_order_id
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(i.payload->'lines') line
    WHERE line->>'platformLineId'=ol.platform_line_id)
  ORDER BY ol.id FOR UPDATE OF ol;
  PERFORM 1 FROM products p WHERE p.user_id=p_user_id AND p.id IN (
    SELECT NULLIF(line->>'productId','')::uuid FROM _channel_batch_input i
      CROSS JOIN LATERAL jsonb_array_elements(i.payload->'lines') line
      WHERE NULLIF(line->>'productId','') IS NOT NULL
    UNION
    SELECT ol.product_id FROM order_lines ol JOIN orders o ON o.id=ol.order_id
      JOIN _channel_batch_input i ON o.user_id=p_user_id AND o.platform=v_platform
        AND o.platform_order_id=i.platform_order_id
      CROSS JOIN LATERAL jsonb_array_elements(i.payload->'lines') line
      WHERE ol.platform_line_id=line->>'platformLineId' AND ol.product_id IS NOT NULL
  ) ORDER BY p.id FOR UPDATE;
  SELECT COALESCE(max(wave), 0) INTO v_max_wave FROM _channel_batch_input;

  FOR v_wave IN 1..v_max_wave LOOP
    CREATE TEMP TABLE _channel_prev_orders ON COMMIT DROP AS
    SELECT i.platform_order_id, o.id, o.status, o.fulfilled_at, o.ordered_at
    FROM _channel_batch_input i LEFT JOIN orders o
      ON o.user_id=p_user_id AND o.platform=v_platform AND o.platform_order_id=i.platform_order_id
    WHERE i.wave=v_wave;
    IF EXISTS (SELECT 1 FROM _channel_batch_input i JOIN _channel_prev_orders p USING(platform_order_id)
      WHERE i.wave=v_wave AND p.id IS NULL AND channel_try_timestamptz(i.payload->>'orderedAt') IS NULL)
    THEN RAISE EXCEPTION 'invalid_ordered_at' USING ERRCODE = '22007'; END IF;

    INSERT INTO orders(user_id,connection_id,platform,platform_order_id,status,ordered_at,buyer_name,currency,total_amount,raw,synced_at)
    SELECT p_user_id,p_connection_id,v_platform,i.platform_order_id,i.payload->>'status',
      COALESCE(channel_try_timestamptz(i.payload->>'orderedAt'),now()),
      i.payload->>'buyerName',i.payload->>'currency',NULLIF(i.payload->>'totalAmount','')::numeric,i.payload->'raw',now()
    FROM _channel_batch_input i WHERE i.wave=v_wave
    ON CONFLICT(user_id,platform,platform_order_id) DO UPDATE SET
      connection_id=EXCLUDED.connection_id,
      status=CASE WHEN EXCLUDED.status IN ('cancelled','refunded') THEN EXCLUDED.status
        WHEN orders.status IN ('cancelled','refunded') THEN orders.status
        WHEN CASE EXCLUDED.status WHEN 'pending' THEN 0 WHEN 'paid' THEN 1 WHEN 'preparing' THEN 2 WHEN 'shipped' THEN 3 WHEN 'delivered' THEN 4 END
           > CASE orders.status WHEN 'pending' THEN 0 WHEN 'paid' THEN 1 WHEN 'preparing' THEN 2 WHEN 'shipped' THEN 3 WHEN 'delivered' THEN 4 END
        THEN EXCLUDED.status ELSE orders.status END,
      ordered_at=COALESCE(LEAST(orders.ordered_at,channel_try_timestamptz((SELECT x.payload->>'orderedAt'
        FROM _channel_batch_input x WHERE x.wave=v_wave AND x.platform_order_id=EXCLUDED.platform_order_id))),orders.ordered_at),
      buyer_name=EXCLUDED.buyer_name,currency=EXCLUDED.currency,total_amount=EXCLUDED.total_amount,
      raw=EXCLUDED.raw,synced_at=now(),updated_at=now();

    CREATE TEMP TABLE _channel_wave_orders ON COMMIT DROP AS
    SELECT i.payload,o.id order_id,o.status next_status,COALESCE(p.status,'pending') prev_status,p.fulfilled_at
    FROM _channel_batch_input i JOIN orders o ON o.user_id=p_user_id AND o.platform=v_platform AND o.platform_order_id=i.platform_order_id
    JOIN _channel_prev_orders p ON p.platform_order_id=i.platform_order_id WHERE i.wave=v_wave;
    CREATE TEMP TABLE _channel_lines ON COMMIT DROP AS
    SELECT w.order_id,line.value payload,line.value->>'platformLineId' platform_line_id,
      old.id line_id,old.product_id old_product_id,old.quantity old_quantity,old.status old_status,
      CASE WHEN old.product_id IS NOT NULL THEN old.product_id WHEN w.fulfilled_at IS NULL THEN product.id END product_id,
      COALESCE(old.quantity,(line.value->>'quantity')::integer) diff_quantity,COALESCE(old.status,'active') diff_status,
      w.prev_status,w.next_status,w.fulfilled_at
    FROM _channel_wave_orders w CROSS JOIN LATERAL jsonb_array_elements(w.payload->'lines') line
    LEFT JOIN order_lines old ON old.order_id=w.order_id AND old.platform_line_id=line.value->>'platformLineId'
    LEFT JOIN products product ON product.user_id=p_user_id AND product.id=NULLIF(line.value->>'productId','')::uuid;
    INSERT INTO order_lines(order_id,user_id,platform_line_id,product_id,platform_product_id,platform_variant_id,title,quantity,unit_price,status)
    SELECT l.order_id,p_user_id,l.platform_line_id,l.product_id,l.payload->>'platformProductId',l.payload->>'platformVariantId',
      l.payload->>'title',(l.payload->>'quantity')::integer,NULLIF(l.payload->>'unitPrice','')::numeric,l.payload->>'status'
    FROM _channel_lines l ON CONFLICT(order_id,platform_line_id) DO UPDATE SET
      title=EXCLUDED.title,quantity=EXCLUDED.quantity,unit_price=EXCLUDED.unit_price,status=EXCLUDED.status,
      platform_product_id=EXCLUDED.platform_product_id,platform_variant_id=EXCLUDED.platform_variant_id,product_id=EXCLUDED.product_id;
    UPDATE _channel_lines l SET line_id=ol.id FROM order_lines ol
    WHERE ol.order_id=l.order_id AND ol.platform_line_id=l.platform_line_id;

    SELECT COALESCE(jsonb_agg(event),'[]'::jsonb) INTO v_events FROM (
      SELECT jsonb_build_object('user_id',p_user_id,'product_id',l.product_id,'delta_units',l.diff_quantity,
        'event_type','order_cancel','reference_id',l.line_id) event FROM _channel_lines l
      WHERE l.product_id IS NOT NULL AND l.diff_quantity<>0 AND l.diff_status='active'
        AND l.payload->>'status' IN ('cancelled','refunded') AND l.fulfilled_at IS NOT NULL
      UNION ALL
      SELECT jsonb_build_object('user_id',p_user_id,'product_id',l.product_id,'delta_units',-l.diff_quantity,
        'event_type','order_fulfillment','reference_id',l.line_id) FROM _channel_lines l
      WHERE v_auto_fulfill AND l.fulfilled_at IS NULL AND l.next_status IN ('shipped','delivered')
        AND l.prev_status NOT IN ('shipped','delivered') AND l.product_id IS NOT NULL
        AND l.diff_quantity<>0 AND l.payload->>'status'='active'
    ) planned;
    IF jsonb_array_length(v_events)>0 THEN
      SELECT insert_product_stock_events_batch(v_events) INTO v_stock_result;
      v_wave_skips:=COALESCE(v_stock_result->'skipped','[]'::jsonb); v_skips:=v_skips||v_wave_skips;
      SELECT v_cancelled+count(*) FILTER(WHERE e->>'event_type'='order_cancel'),
        v_fulfilled+count(*) FILTER(WHERE e->>'event_type'='order_fulfillment' AND NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements(v_wave_skips) s WHERE s->>'reference_id'=e->>'reference_id'))
      INTO v_cancelled,v_fulfilled FROM jsonb_array_elements(v_events) e;
      UPDATE orders o SET fulfilled_at=now(),updated_at=now() WHERE o.fulfilled_at IS NULL AND EXISTS(
        SELECT 1 FROM jsonb_array_elements(v_events) e JOIN order_lines ol ON ol.id=(e->>'reference_id')::uuid
        WHERE e->>'event_type'='order_fulfillment' AND ol.order_id=o.id AND NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements(v_wave_skips) s WHERE s->>'reference_id'=e->>'reference_id'));
    END IF;
    UPDATE order_dispatches d SET status='confirmed',confirmed_at=now(),updated_at=now()
    FROM _channel_wave_orders w WHERE d.order_id=w.order_id AND d.status='sent' AND w.next_status IN ('shipped','delivered');
    v_upserted:=v_upserted+(SELECT count(*) FROM _channel_wave_orders);
    DROP TABLE _channel_lines,_channel_wave_orders,_channel_prev_orders;
  END LOOP;
  DROP TABLE _channel_batch_input;
  RETURN jsonb_build_object('upserted',v_upserted,'cancelledCompensations',v_cancelled,
    'autoFulfillments',v_fulfilled,'stockEventSkips',v_skips);
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_channel_orders_batch(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_channel_orders_batch(uuid,uuid,jsonb) TO service_role;
