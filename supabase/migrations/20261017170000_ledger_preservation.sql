-- Ledger preservation (#890, #894, #897). Stacked on #875 stock-hold batch sync.
-- Fulfillment uses post-upsert line quantity; cancel/refund restores net deducted units.
-- Session inbound upsert applies after batch estimate; blend output capped at input sum.

GRANT USAGE ON SCHEMA auth TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.order_line_outstanding_units(p_line_id uuid)
RETURNS TABLE(product_id uuid, units integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT pse.product_id, (-SUM(pse.delta_units))::integer
  FROM public.product_stock_events pse
  WHERE pse.reference_id = p_line_id
    AND pse.event_type IN ('order_fulfillment', 'order_cancel')
  GROUP BY pse.product_id
  HAVING -SUM(pse.delta_units) > 0;
$function$;

REVOKE ALL ON FUNCTION public.order_line_outstanding_units(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_line_outstanding_units(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_status text;
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

  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id)
  SELECT ol.user_id, outstanding.product_id, outstanding.units, 'order_cancel', ol.id
  FROM order_lines ol
  CROSS JOIN LATERAL public.order_line_outstanding_units(ol.id) outstanding
  WHERE ol.order_id = p_order_id
  ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING;

  UPDATE orders SET status = 'cancelled', updated_at = now()
  WHERE id = p_order_id AND status <> 'cancelled';
END;
$function$;


-- sync_channel_orders_batch (#890 on #875 body)
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
      status=CASE
        WHEN EXCLUDED.status IN ('cancelled','refunded') OR orders.status IN ('cancelled','refunded') THEN orders.status
        WHEN CASE EXCLUDED.status WHEN 'pending' THEN 0 WHEN 'paid' THEN 1 WHEN 'preparing' THEN 2 WHEN 'shipped' THEN 3 WHEN 'delivered' THEN 4 END
           > CASE orders.status WHEN 'pending' THEN 0 WHEN 'paid' THEN 1 WHEN 'preparing' THEN 2 WHEN 'shipped' THEN 3 WHEN 'delivered' THEN 4 END
        THEN EXCLUDED.status ELSE orders.status END,
      ordered_at=COALESCE(LEAST(orders.ordered_at,channel_try_timestamptz((SELECT x.payload->>'orderedAt'
        FROM _channel_batch_input x WHERE x.wave=v_wave AND x.platform_order_id=EXCLUDED.platform_order_id))),orders.ordered_at),
      buyer_name=EXCLUDED.buyer_name,currency=EXCLUDED.currency,
      total_amount=CASE
        WHEN EXCLUDED.total_amount IS NULL THEN orders.total_amount
        WHEN orders.total_amount IS NULL THEN EXCLUDED.total_amount
        WHEN EXCLUDED.total_amount > orders.total_amount THEN EXCLUDED.total_amount
        ELSE orders.total_amount END,
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
      COALESCE(old.status,'active') diff_status,
      w.prev_status,w.next_status,w.fulfilled_at
    FROM _channel_wave_orders w CROSS JOIN LATERAL jsonb_array_elements(w.payload->'lines') line
    LEFT JOIN order_lines old ON old.order_id=w.order_id AND old.platform_line_id=line.value->>'platformLineId'
    LEFT JOIN products product ON product.user_id=p_user_id AND product.id=NULLIF(line.value->>'productId','')::uuid;
    INSERT INTO order_lines(order_id,user_id,platform_line_id,product_id,platform_product_id,platform_variant_id,title,quantity,unit_price,status)
    SELECT l.order_id,p_user_id,l.platform_line_id,l.product_id,l.payload->>'platformProductId',l.payload->>'platformVariantId',
      l.payload->>'title',(l.payload->>'quantity')::integer,NULLIF(l.payload->>'unitPrice','')::numeric,l.payload->>'status'
    FROM _channel_lines l ON CONFLICT(order_id,platform_line_id) DO UPDATE SET
      title=EXCLUDED.title,
      quantity=CASE
        WHEN order_lines.status IN ('cancelled','refunded') THEN order_lines.quantity
        WHEN EXCLUDED.status IN ('cancelled','refunded') THEN order_lines.quantity
        ELSE EXCLUDED.quantity END,
      unit_price=CASE
        WHEN order_lines.status IN ('cancelled','refunded') THEN order_lines.unit_price
        WHEN EXCLUDED.status IN ('cancelled','refunded') AND order_lines.unit_price IS NOT NULL THEN order_lines.unit_price
        ELSE EXCLUDED.unit_price END,
      status=CASE
        WHEN order_lines.status = 'refunded' THEN order_lines.status
        WHEN order_lines.status = 'cancelled' AND EXCLUDED.status = 'refunded' THEN EXCLUDED.status
        WHEN order_lines.status IN ('cancelled','refunded') THEN order_lines.status
        ELSE EXCLUDED.status END,
      platform_product_id=EXCLUDED.platform_product_id,platform_variant_id=EXCLUDED.platform_variant_id,product_id=EXCLUDED.product_id;
    UPDATE _channel_lines l SET line_id=ol.id FROM order_lines ol
    WHERE ol.order_id=l.order_id AND ol.platform_line_id=l.platform_line_id;

    UPDATE orders o
    SET status = resolved.next_status,
        total_amount = resolved.total_amount,
        updated_at = now()
    FROM (
      SELECT w.order_id,
        CASE
          WHEN stats.line_count > 0 AND stats.active_count = 0 THEN
            CASE WHEN stats.refunded_count > 0 THEN 'refunded' ELSE 'cancelled' END
          WHEN o2.status IN ('cancelled','refunded')
            AND stats.active_count > 0
            AND stats.line_count > stats.active_count THEN
            CASE
              WHEN (w.payload->>'status') IN ('pending','paid','preparing','shipped','delivered')
                THEN w.payload->>'status'
              ELSE 'paid'
            END
          ELSE o2.status
        END AS next_status,
        (SELECT max(v) FROM (VALUES (o2.total_amount), (stats.line_gross)) AS amounts(v)) AS total_amount
      FROM _channel_wave_orders w
      JOIN orders o2 ON o2.id = w.order_id
      JOIN LATERAL (
        SELECT count(*) AS line_count,
          count(*) FILTER (WHERE ol.status = 'active') AS active_count,
          count(*) FILTER (WHERE ol.status = 'refunded') AS refunded_count,
          sum(ol.unit_price * ol.quantity) AS line_gross
        FROM order_lines ol
        WHERE ol.order_id = w.order_id
      ) stats ON true
    ) resolved
    WHERE o.id = resolved.order_id
      AND (o.status IS DISTINCT FROM resolved.next_status OR o.total_amount IS DISTINCT FROM resolved.total_amount);
    UPDATE _channel_wave_orders w
    SET next_status = o.status
    FROM orders o
    WHERE o.id = w.order_id;
    UPDATE _channel_lines l
    SET next_status = w.next_status
    FROM _channel_wave_orders w
    WHERE w.order_id = l.order_id;

    UPDATE order_fulfillment_holds h SET resolved_at=now(),updated_at=now()
    FROM _channel_wave_orders w
    JOIN orders o ON o.id = w.order_id
    WHERE h.order_id=w.order_id AND h.resolved_at IS NULL
      AND o.status IN ('cancelled','refunded');

    SELECT COALESCE(jsonb_agg(event),'[]'::jsonb) INTO v_events FROM (
      SELECT jsonb_build_object('user_id',p_user_id,'product_id',outstanding.product_id,'delta_units',outstanding.units,
        'event_type','order_cancel','reference_id',l.line_id) event FROM _channel_lines l
      CROSS JOIN LATERAL public.order_line_outstanding_units(l.line_id) outstanding
      WHERE l.line_id IS NOT NULL AND l.product_id IS NOT NULL AND l.diff_status='active'
        AND l.payload->>'status' IN ('cancelled','refunded') AND l.fulfilled_at IS NOT NULL
      UNION ALL
      SELECT jsonb_build_object('user_id',p_user_id,'product_id',ol.product_id,'delta_units',-ol.quantity,
        'event_type','order_fulfillment','reference_id',ol.id) FROM _channel_lines l
      JOIN order_lines ol ON ol.id = l.line_id
      WHERE v_auto_fulfill AND l.fulfilled_at IS NULL AND l.next_status IN ('shipped','delivered')
        AND l.prev_status NOT IN ('shipped','delivered') AND ol.product_id IS NOT NULL
        AND ol.quantity > 0 AND l.payload->>'status'='active'
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
        SELECT COALESCE(jsonb_agg(public.fulfillment_shortage_entry(
          agg.product_id, agg.line_id, agg.required_units, COALESCE(sb.units, 0)
        )), '[]'::jsonb)
        INTO v_shortages
        FROM (
          SELECT fp.product_id,
                 SUM(fp.required_units)::integer AS required_units,
                 (array_agg(fp.line_id ORDER BY fp.line_id))[1] AS line_id
          FROM _fulfill_plan fp
          WHERE fp.order_id = v_order_rec.order_id
          GROUP BY fp.product_id
        ) agg
        LEFT JOIN _sim_balance sb ON sb.product_id = agg.product_id
        WHERE COALESCE(sb.units, 0) < agg.required_units;

        v_is_short := jsonb_array_length(v_shortages) > 0;
        IF v_is_short THEN
          INSERT INTO _wave_held VALUES (v_order_rec.order_id, v_shortages);
        ELSE
          UPDATE _sim_balance sb SET units=sb.units-agg.total_units
          FROM (
            SELECT fp.product_id, SUM(fp.required_units)::integer AS total_units
            FROM _fulfill_plan fp
            WHERE fp.order_id=v_order_rec.order_id
            GROUP BY fp.product_id
          ) agg
          WHERE sb.product_id=agg.product_id;
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

    -- Open holds in this wave: refresh shortages after this wave's stock effects (no auto-retry).
    FOR v_order_rec IN
      SELECT w.order_id,o.ordered_at,o.platform_order_id
      FROM _channel_wave_orders w
      JOIN orders o ON o.id=w.order_id
      WHERE w.fulfilled_at IS NULL AND w.next_status IN ('shipped','delivered')
        AND EXISTS (SELECT 1 FROM order_fulfillment_holds h WHERE h.order_id=w.order_id AND h.resolved_at IS NULL)
    LOOP
      v_shortages := public.order_fulfillment_shortages_json(v_order_rec.order_id, false);
      UPDATE order_fulfillment_holds h SET shortages=v_shortages,updated_at=now()
      WHERE h.order_id=v_order_rec.order_id AND h.resolved_at IS NULL;
    END LOOP;

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

CREATE OR REPLACE FUNCTION upsert_roasted_inbound(
  p_session_id uuid, p_user_id uuid, p_grams integer, p_is_estimate boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
  v_bean_id uuid;
  v_blend_id uuid;
  v_batch_id uuid;
BEGIN
  IF p_grams <= 0 THEN RETURN; END IF;

  SELECT s.bean_id, b.blend_id, s.plan_batch_id INTO v_bean_id, v_blend_id, v_batch_id
  FROM roast_sessions s
  LEFT JOIN roast_plan_batches b ON b.id = s.plan_batch_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM roasted_stock_events
    WHERE reference_id = p_session_id AND event_type = 'roast_inbound'
  ) AND v_batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM roasted_stock_events
    WHERE reference_id = v_batch_id AND event_type = 'roast_inbound'
  ) THEN
    RETURN;
  END IF;

  IF v_blend_id IS NOT NULL THEN
    v_bean_id := NULL;
  ELSIF v_bean_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by)
  VALUES (p_user_id, v_bean_id, v_blend_id, p_grams, 'roast_inbound', p_session_id, p_is_estimate, auth.uid())
  ON CONFLICT (reference_id) WHERE event_type = 'roast_inbound'
  DO UPDATE SET delta_grams = EXCLUDED.delta_grams, is_estimate = EXCLUDED.is_estimate;
END;
$$;


GRANT EXECUTE ON FUNCTION upsert_roasted_inbound(uuid, uuid, integer, boolean) TO authenticated;


CREATE OR REPLACE FUNCTION insert_roasted_stock_events_batch(p_events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ref uuid;
  v_output integer;
  v_input integer;
BEGIN
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_events_payload' USING ERRCODE = '22023';
  END IF;

  FOR v_ref IN
    SELECT DISTINCT NULLIF(e->>'reference_id', '')::uuid
    FROM jsonb_array_elements(p_events) AS e
    WHERE (e->>'event_type') IN ('blend_produce', 'blend_consume')
  LOOP
    SELECT COALESCE(SUM(trunc((e->>'delta_grams')::numeric)::integer) FILTER (WHERE e->>'event_type' = 'blend_produce'), 0),
           COALESCE(-SUM(trunc((e->>'delta_grams')::numeric)::integer) FILTER (WHERE e->>'event_type' = 'blend_consume'), 0)
      INTO v_output, v_input
    FROM jsonb_array_elements(p_events) AS e
    WHERE (e->>'event_type') IN ('blend_produce', 'blend_consume')
      AND NULLIF(e->>'reference_id', '')::uuid IS NOT DISTINCT FROM v_ref;

    IF v_output > v_input THEN
      RAISE EXCEPTION 'blend_output_exceeds_input'
        USING ERRCODE = 'check_violation',
              DETAIL = format('reference_id=%s output_grams=%s input_grams=%s', v_ref, v_output, v_input);
    END IF;
  END LOOP;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate)
  SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
         trunc((e->>'delta_grams')::numeric)::integer, e->>'event_type', (e->>'reference_id')::uuid,
         e->>'note', COALESCE((e->>'is_estimate')::boolean, false)
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_roasted_stock_events_batch(jsonb) TO authenticated;
