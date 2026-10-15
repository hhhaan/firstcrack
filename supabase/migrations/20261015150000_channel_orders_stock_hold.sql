-- #751 / #872 PR1: short stock holds one order's auto-fulfillment instead of aborting the batch.

CREATE TABLE public.order_fulfillment_holds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.sales_channel_connections(id) ON DELETE SET NULL,
  reason        text NOT NULL DEFAULT 'insufficient_product_stock',
  shortages     jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE UNIQUE INDEX order_fulfillment_holds_open_order_idx
  ON public.order_fulfillment_holds (order_id)
  WHERE resolved_at IS NULL;

CREATE INDEX order_fulfillment_holds_user_open_idx
  ON public.order_fulfillment_holds (user_id)
  WHERE resolved_at IS NULL;

ALTER TABLE public.order_fulfillment_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace read order_fulfillment_holds" ON public.order_fulfillment_holds
  FOR SELECT USING (public.has_workspace_access(user_id));

GRANT SELECT ON public.order_fulfillment_holds TO authenticated;

-- ---------------------------------------------------------------------------
-- sync_channel_orders_batch: pre-filter fulfillment on stock / open holds
-- ---------------------------------------------------------------------------
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
  v_held jsonb := '[]'::jsonb;
  v_held_fulfillments integer := 0;
  v_order_rec RECORD;
  v_line_rec RECORD;
  v_balance integer;
  v_shortages jsonb;
  v_is_short boolean;
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
    SELECT i.payload,o.id order_id,o.status next_status,COALESCE(p.status,'pending') prev_status,p.fulfilled_at,
           o.ordered_at,o.platform_order_id
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

    UPDATE order_fulfillment_holds h SET resolved_at=now(),updated_at=now()
    FROM _channel_wave_orders w
    WHERE h.order_id=w.order_id AND h.resolved_at IS NULL
      AND w.next_status IN ('cancelled','refunded');

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
        AND NOT EXISTS (
          SELECT 1 FROM order_fulfillment_holds h
          WHERE h.order_id=l.order_id AND h.resolved_at IS NULL
        )
    ) planned;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_events) e WHERE e->>'event_type'='order_fulfillment') THEN
      CREATE TEMP TABLE _fulfill_plan ON COMMIT DROP AS
      SELECT (e->>'reference_id')::uuid AS line_id,
             (e->>'product_id')::uuid AS product_id,
             ABS((e->>'delta_units')::integer) AS required_units,
             ol.order_id
      FROM jsonb_array_elements(v_events) e
      JOIN order_lines ol ON ol.id=(e->>'reference_id')::uuid
      WHERE e->>'event_type'='order_fulfillment';

      CREATE TEMP TABLE _sim_balance ON COMMIT DROP AS
      SELECT fp.product_id, COALESCE(SUM(pse.delta_units),0)::integer AS units
      FROM (SELECT DISTINCT product_id FROM _fulfill_plan) fp
      LEFT JOIN product_stock_events pse ON pse.product_id=fp.product_id
      GROUP BY fp.product_id;

      CREATE TEMP TABLE _wave_held (order_id uuid PRIMARY KEY, shortages jsonb NOT NULL) ON COMMIT DROP;

      FOR v_order_rec IN
        SELECT DISTINCT o.id AS order_id, o.ordered_at, o.platform_order_id
        FROM _fulfill_plan fp
        JOIN orders o ON o.id=fp.order_id
        ORDER BY o.ordered_at, o.platform_order_id
      LOOP
        v_shortages := '[]'::jsonb;
        v_is_short := false;
        FOR v_line_rec IN
          SELECT fp.line_id, fp.product_id, fp.required_units
          FROM _fulfill_plan fp WHERE fp.order_id=v_order_rec.order_id
          ORDER BY fp.line_id
        LOOP
          SELECT COALESCE(sb.units, 0) INTO v_balance FROM _sim_balance sb WHERE sb.product_id=v_line_rec.product_id;
          IF v_balance IS NULL THEN v_balance := 0; END IF;
          IF v_balance < v_line_rec.required_units THEN
            v_is_short := true;
            v_shortages := v_shortages || jsonb_build_object(
              'product_id', v_line_rec.product_id,
              'order_line_id', v_line_rec.line_id,
              'required_units', v_line_rec.required_units,
              'available_units', GREATEST(v_balance, 0)
            );
          END IF;
        END LOOP;
        IF v_is_short THEN
          INSERT INTO _wave_held VALUES (v_order_rec.order_id, v_shortages);
        ELSE
          UPDATE _sim_balance sb SET units=sb.units-fp.required_units
          FROM _fulfill_plan fp
          WHERE fp.order_id=v_order_rec.order_id AND sb.product_id=fp.product_id;
        END IF;
      END LOOP;

      SELECT COALESCE(jsonb_agg(e),'[]'::jsonb) INTO v_events
      FROM jsonb_array_elements(v_events) e
      WHERE e->>'event_type'<>'order_fulfillment'
         OR NOT EXISTS (
           SELECT 1 FROM _wave_held h
           JOIN order_lines ol ON ol.order_id=h.order_id
           WHERE ol.id=(e->>'reference_id')::uuid
         );

      INSERT INTO order_fulfillment_holds(user_id,order_id,connection_id,reason,shortages)
      SELECT p_user_id,h.order_id,p_connection_id,'insufficient_product_stock',h.shortages
      FROM _wave_held h
      ON CONFLICT (order_id) WHERE resolved_at IS NULL DO UPDATE SET
        shortages=EXCLUDED.shortages,connection_id=EXCLUDED.connection_id,updated_at=now();

      SELECT v_held||COALESCE(jsonb_agg(jsonb_build_object(
        'order_id',h.order_id,'platform_order_id',o.platform_order_id,'shortages',h.shortages)),'[]'::jsonb)
      INTO v_held
      FROM _wave_held h JOIN orders o ON o.id=h.order_id;

      v_held_fulfillments := v_held_fulfillments+(SELECT count(*)::integer FROM _wave_held);

      DROP TABLE _fulfill_plan,_sim_balance,_wave_held;
    END IF;

    -- Open holds in this wave: refresh shortages only (no auto-retry on sync).
    FOR v_order_rec IN
      SELECT w.order_id,o.ordered_at,o.platform_order_id
      FROM _channel_wave_orders w
      JOIN orders o ON o.id=w.order_id
      WHERE w.fulfilled_at IS NULL AND w.next_status IN ('shipped','delivered')
        AND EXISTS (SELECT 1 FROM order_fulfillment_holds h WHERE h.order_id=w.order_id AND h.resolved_at IS NULL)
    LOOP
      v_shortages := '[]'::jsonb;
      FOR v_line_rec IN
        SELECT ol.id AS line_id, ol.product_id, ol.quantity AS required_units
        FROM order_lines ol
        WHERE ol.order_id=v_order_rec.order_id AND ol.status='active' AND ol.product_id IS NOT NULL
        ORDER BY ol.id
      LOOP
        SELECT COALESCE(SUM(pse.delta_units),0)::integer INTO v_balance
        FROM product_stock_events pse WHERE pse.product_id=v_line_rec.product_id;
        IF v_balance IS NULL THEN v_balance := 0; END IF;
        IF v_balance < v_line_rec.required_units THEN
          v_shortages := v_shortages || jsonb_build_object(
            'product_id', v_line_rec.product_id,
            'order_line_id', v_line_rec.line_id,
            'required_units', v_line_rec.required_units,
            'available_units', GREATEST(v_balance, 0)
          );
        END IF;
      END LOOP;
      UPDATE order_fulfillment_holds h SET shortages=v_shortages,updated_at=now()
      WHERE h.order_id=v_order_rec.order_id AND h.resolved_at IS NULL;
    END LOOP;

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
          SELECT 1 FROM jsonb_array_elements(v_wave_skips) s WHERE s->>'reference_id'=e->>'reference_id'))
        AND NOT EXISTS (
          SELECT 1 FROM order_fulfillment_holds h WHERE h.order_id=o.id AND h.resolved_at IS NULL
        );
    END IF;
    UPDATE order_dispatches d SET status='confirmed',confirmed_at=now(),updated_at=now()
    FROM _channel_wave_orders w WHERE d.order_id=w.order_id AND d.status='sent' AND w.next_status IN ('shipped','delivered');
    v_upserted:=v_upserted+(SELECT count(*) FROM _channel_wave_orders);
    DROP TABLE _channel_lines,_channel_wave_orders,_channel_prev_orders;
  END LOOP;
  DROP TABLE _channel_batch_input;
  RETURN jsonb_build_object(
    'upserted',v_upserted,'cancelledCompensations',v_cancelled,
    'autoFulfillments',v_fulfilled,'stockEventSkips',v_skips,
    'held',v_held,'heldFulfillments',v_held_fulfillments);
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_channel_orders_batch(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_channel_orders_batch(uuid,uuid,jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- retry_order_fulfillment: explicit retry after restock (or manual path via fulfill_order)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_order_fulfillment(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_user_id uuid;
  v_fulfilled_at timestamptz;
  v_shortages jsonb := '[]'::jsonb;
  v_line_rec RECORD;
  v_balance integer;
  v_products uuid[];
  v_bad_product uuid;
  v_bad_units integer;
BEGIN
  SELECT o.user_id, o.status, o.fulfilled_at INTO v_user_id, v_status, v_fulfilled_at
  FROM orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_access(v_user_id) THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'no_data_found', DETAIL = format('order_id=%s', p_order_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM order_fulfillment_holds h WHERE h.order_id = p_order_id AND h.resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'order_fulfillment_hold_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_terminal_not_fulfillable' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status NOT IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'order_not_shipped' USING ERRCODE = 'check_violation';
  END IF;
  IF v_fulfilled_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_already_fulfilled' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_line_rec IN
    SELECT ol.id AS line_id, ol.product_id, ol.quantity AS required_units
    FROM order_lines ol
    WHERE ol.order_id = p_order_id AND ol.status = 'active' AND ol.product_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM product_stock_events pse
        WHERE pse.reference_id = ol.id AND pse.event_type = 'order_fulfillment'
      )
    ORDER BY ol.id
  LOOP
    SELECT COALESCE(SUM(pse.delta_units), 0)::integer INTO v_balance
    FROM product_stock_events pse WHERE pse.product_id = v_line_rec.product_id;
    IF v_balance < v_line_rec.required_units THEN
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', v_line_rec.product_id,
        'order_line_id', v_line_rec.line_id,
        'required_units', v_line_rec.required_units,
        'available_units', GREATEST(v_balance, 0)
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_shortages) > 0 THEN
    UPDATE order_fulfillment_holds SET shortages = v_shortages, updated_at = now()
    WHERE order_id = p_order_id AND resolved_at IS NULL;
    RAISE EXCEPTION 'insufficient_product_stock'
      USING ERRCODE = 'check_violation',
            DETAIL = format('order_id=%s shortages=%s', p_order_id, v_shortages::text);
  END IF;

  WITH ins AS (
    INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, created_by)
    SELECT ol.user_id, ol.product_id, -ol.quantity, 'order_fulfillment', ol.id, auth.uid()
    FROM order_lines ol
    WHERE ol.order_id = p_order_id AND ol.status = 'active' AND ol.product_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM product_stock_events pse
        WHERE pse.reference_id = ol.id AND pse.event_type = 'order_fulfillment'
      )
    ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING
    RETURNING product_id
  )
  SELECT array_agg(DISTINCT product_id) INTO v_products FROM ins;

  IF v_products IS NOT NULL THEN
    SELECT pse.product_id, SUM(pse.delta_units)::integer
      INTO v_bad_product, v_bad_units
    FROM product_stock_events pse
    WHERE pse.product_id = ANY (v_products)
    GROUP BY pse.product_id
    HAVING SUM(pse.delta_units) < 0
    LIMIT 1;
    IF v_bad_product IS NOT NULL THEN
      RAISE EXCEPTION 'insufficient_product_stock'
        USING ERRCODE = 'check_violation',
              DETAIL = format('order_id=%s product_id=%s balance_units=%s', p_order_id, v_bad_product, v_bad_units);
    END IF;
  END IF;

  UPDATE orders SET fulfilled_at = now(), updated_at = now()
  WHERE id = p_order_id AND fulfilled_at IS NULL;

  UPDATE order_fulfillment_holds SET resolved_at = now(), updated_at = now()
  WHERE order_id = p_order_id AND resolved_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.retry_order_fulfillment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_order_fulfillment(uuid) TO authenticated, service_role;

-- Manual fulfill_order clears an open hold once stock is deducted.
CREATE OR REPLACE FUNCTION public.fulfill_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_status         text;
  v_products       uuid[];
  v_bad_product    uuid;
  v_bad_units      integer;
BEGIN
  SELECT o.status INTO v_status
  FROM orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found'
      USING ERRCODE = 'no_data_found',
            DETAIL = format('order_id=%s', p_order_id);
  END IF;

  IF v_status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_terminal_not_fulfillable'
      USING ERRCODE = 'check_violation',
            DETAIL = format('order_id=%s status=%s', p_order_id, v_status);
  END IF;

  WITH ins AS (
    INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, created_by)
    SELECT ol.user_id, ol.product_id, -ol.quantity, 'order_fulfillment', ol.id, auth.uid()
    FROM order_lines ol
    WHERE ol.order_id = p_order_id AND ol.status = 'active' AND ol.product_id IS NOT NULL
    ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING
    RETURNING product_id
  )
  SELECT array_agg(DISTINCT product_id) INTO v_products FROM ins;

  IF v_products IS NOT NULL THEN
    SELECT pse.product_id, SUM(pse.delta_units)::integer
      INTO v_bad_product, v_bad_units
    FROM product_stock_events pse
    WHERE pse.product_id = ANY (v_products)
    GROUP BY pse.product_id
    HAVING SUM(pse.delta_units) < 0
    LIMIT 1;

    IF v_bad_product IS NOT NULL THEN
      RAISE EXCEPTION 'insufficient_product_stock'
        USING ERRCODE = 'check_violation',
              DETAIL = format('order_id=%s product_id=%s balance_units=%s',
                              p_order_id, v_bad_product, v_bad_units);
    END IF;
  END IF;

  UPDATE orders SET fulfilled_at = now(), updated_at = now()
  WHERE id = p_order_id AND fulfilled_at IS NULL;

  UPDATE order_fulfillment_holds SET resolved_at = now(), updated_at = now()
  WHERE order_id = p_order_id AND resolved_at IS NULL;
END;
$function$;
