-- #889: lock the stock parent rows before a deduction so two different orders or
-- packaging ops cannot both pass the post-insert balance check.
-- Lock order is products, then beans, then blends, each by id.

CREATE OR REPLACE FUNCTION public.lock_stock_parents(
  p_products uuid[],
  p_beans uuid[],
  p_blends uuid[]
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM 1
  FROM public.products
  WHERE id = ANY (COALESCE(p_products, ARRAY[]::uuid[]))
  ORDER BY id
  FOR UPDATE;

  PERFORM 1
  FROM public.beans
  WHERE id = ANY (COALESCE(p_beans, ARRAY[]::uuid[]))
  ORDER BY id
  FOR UPDATE;

  PERFORM 1
  FROM public.blends
  WHERE id = ANY (COALESCE(p_blends, ARRAY[]::uuid[]))
  ORDER BY id
  FOR UPDATE;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_stock_parents(uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_stock_parents(uuid[], uuid[], uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fulfill_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
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

  PERFORM public.lock_stock_parents(
    ARRAY(
      SELECT DISTINCT ol.product_id
      FROM order_lines ol
      WHERE ol.order_id = p_order_id AND ol.product_id IS NOT NULL
    ),
    NULL,
    NULL
  );

  WITH ins AS (
    INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, created_by)
    SELECT ol.user_id, ol.product_id, -ol.quantity, 'order_fulfillment', ol.id, auth.uid()
    FROM order_lines ol
    WHERE ol.order_id = p_order_id AND ol.status = 'active' AND ol.product_id IS NOT NULL
    ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING
    RETURNING product_id, delta_units
  ),
  call_net AS (
    SELECT product_id, SUM(delta_units) AS call_units
    FROM ins
    GROUP BY product_id
  )
  SELECT array_agg(product_id) FILTER (WHERE call_units < 0)
    INTO v_products
  FROM call_net;

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
END;
$function$;

CREATE OR REPLACE FUNCTION public.insert_product_stock_events_batch(p_events jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_products    uuid[];
  v_bad_product uuid;
  v_bad_units   integer;
  v_skipped     jsonb := '[]'::jsonb;
BEGIN
  PERFORM 1
  FROM orders o
  WHERE o.id IN (
    SELECT ol.order_id
    FROM order_lines ol
    WHERE ol.id IN (
      SELECT NULLIF(e->>'reference_id', '')::uuid
      FROM jsonb_array_elements(p_events) AS e
      WHERE (e->>'event_type') IN ('order_fulfillment', 'order_cancel')
    )
  )
  ORDER BY o.id
  FOR UPDATE;

  PERFORM public.lock_stock_parents(
    ARRAY(
      SELECT DISTINCT (e->>'product_id')::uuid
      FROM jsonb_array_elements(p_events) AS e
      WHERE NULLIF(e->>'product_id', '') IS NOT NULL
    ),
    NULL,
    NULL
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'reference_id', t.reference_id,
           'order_id', t.order_id,
           'order_status', t.status,
           'reason', 'order_terminal_not_fulfillable')), '[]'::jsonb)
    INTO v_skipped
  FROM (
    SELECT DISTINCT ol.id AS reference_id, ol.order_id, o.status
    FROM jsonb_array_elements(p_events) AS e
    JOIN order_lines ol ON ol.id = NULLIF(e->>'reference_id', '')::uuid
    JOIN orders o ON o.id = ol.order_id
    WHERE (e->>'event_type') = 'order_fulfillment'
      AND o.status IN ('cancelled', 'refunded')
  ) t;

  WITH ev AS (
    SELECT
      (e->>'user_id')::uuid                                    AS user_id,
      (e->>'product_id')::uuid                                 AS product_id,
      (e->>'delta_units')::integer                             AS delta_units,
      (e->>'event_type')::text                                 AS event_type,
      NULLIF(e->>'reference_id', '')::uuid                     AS reference_id,
      NULLIF(e->>'note', '')                                   AS note,
      COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid()) AS created_by
    FROM jsonb_array_elements(p_events) AS e
  ),
  ins AS (
    INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note, created_by)
    SELECT ev.user_id, ev.product_id, ev.delta_units, ev.event_type, ev.reference_id, ev.note, ev.created_by
    FROM ev
    WHERE NOT (
      ev.event_type = 'order_fulfillment'
      AND ev.reference_id IN (
        SELECT (s->>'reference_id')::uuid FROM jsonb_array_elements(v_skipped) AS s
      )
    )
    ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING
    RETURNING product_id, delta_units
  ),
  call_net AS (
    SELECT product_id, SUM(delta_units) AS call_units
    FROM ins
    GROUP BY product_id
  )
  SELECT array_agg(product_id) FILTER (WHERE call_units < 0)
    INTO v_products
  FROM call_net;

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
              DETAIL = format('product_id=%s balance_units=%s', v_bad_product, v_bad_units);
    END IF;
  END IF;

  RETURN jsonb_build_object('skipped', v_skipped);
END;
$function$;
