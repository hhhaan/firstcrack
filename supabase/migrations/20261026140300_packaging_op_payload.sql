-- #892: the same packaging reference is a replay only when the stock payload matches.
-- A different product, quantity, or bean raises and writes nothing.
-- Parents are locked before insert (#889).

CREATE OR REPLACE FUNCTION public.insert_packaging_op(p_product_events jsonb, p_roasted_events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_ref uuid;
  v_products uuid[];
  v_beans uuid[];
  v_blends uuid[];
  v_bad_id uuid;
  v_bad_amount integer;
  v_mismatch boolean;
BEGIN
  FOR v_ref IN
    SELECT DISTINCT ref
    FROM (
      SELECT NULLIF(e->>'reference_id', '')::uuid AS ref
      FROM jsonb_array_elements(COALESCE(p_product_events, '[]'::jsonb)) AS e
      UNION ALL
      SELECT NULLIF(e->>'reference_id', '')::uuid
      FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
    ) refs
    WHERE ref IS NOT NULL
  LOOP
    IF EXISTS (SELECT 1 FROM product_stock_events WHERE reference_id = v_ref)
       OR EXISTS (SELECT 1 FROM roasted_stock_events WHERE reference_id = v_ref)
    THEN
      v_mismatch := EXISTS (
        SELECT (e->>'product_id')::uuid, (e->>'delta_units')::integer, (e->>'event_type')::text, (e->>'user_id')::uuid
        FROM jsonb_array_elements(COALESCE(p_product_events, '[]'::jsonb)) AS e
        WHERE NULLIF(e->>'reference_id', '')::uuid = v_ref
        EXCEPT
        SELECT product_id, delta_units, event_type, user_id
        FROM product_stock_events
        WHERE reference_id = v_ref
      ) OR EXISTS (
        SELECT product_id, delta_units, event_type, user_id
        FROM product_stock_events
        WHERE reference_id = v_ref
        EXCEPT
        SELECT (e->>'product_id')::uuid, (e->>'delta_units')::integer, (e->>'event_type')::text, (e->>'user_id')::uuid
        FROM jsonb_array_elements(COALESCE(p_product_events, '[]'::jsonb)) AS e
        WHERE NULLIF(e->>'reference_id', '')::uuid = v_ref
      ) OR EXISTS (
        SELECT
          NULLIF(e->>'bean_id', '')::uuid,
          NULLIF(e->>'blend_id', '')::uuid,
          (e->>'delta_grams')::integer,
          (e->>'event_type')::text,
          (e->>'user_id')::uuid
        FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
        WHERE NULLIF(e->>'reference_id', '')::uuid = v_ref
        EXCEPT
        SELECT bean_id, blend_id, delta_grams, event_type, user_id
        FROM roasted_stock_events
        WHERE reference_id = v_ref
      ) OR EXISTS (
        SELECT bean_id, blend_id, delta_grams, event_type, user_id
        FROM roasted_stock_events
        WHERE reference_id = v_ref
        EXCEPT
        SELECT
          NULLIF(e->>'bean_id', '')::uuid,
          NULLIF(e->>'blend_id', '')::uuid,
          (e->>'delta_grams')::integer,
          (e->>'event_type')::text,
          (e->>'user_id')::uuid
        FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
        WHERE NULLIF(e->>'reference_id', '')::uuid = v_ref
      );

      IF v_mismatch THEN
        RAISE EXCEPTION 'packaging_op_payload_conflict'
          USING ERRCODE = 'unique_violation',
                DETAIL = format('reference_id=%s', v_ref);
      END IF;
    END IF;
  END LOOP;

  PERFORM public.lock_stock_parents(
    ARRAY(
      SELECT DISTINCT (e->>'product_id')::uuid
      FROM jsonb_array_elements(COALESCE(p_product_events, '[]'::jsonb)) AS e
      WHERE NULLIF(e->>'product_id', '') IS NOT NULL
    ),
    ARRAY(
      SELECT DISTINCT NULLIF(e->>'bean_id', '')::uuid
      FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
      WHERE NULLIF(e->>'bean_id', '') IS NOT NULL
    ),
    ARRAY(
      SELECT DISTINCT NULLIF(e->>'blend_id', '')::uuid
      FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
      WHERE NULLIF(e->>'blend_id', '') IS NOT NULL
    )
  );

  WITH ins AS (
    INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note)
    SELECT
      (e->>'user_id')::uuid,
      (e->>'product_id')::uuid,
      (e->>'delta_units')::integer,
      (e->>'event_type')::text,
      NULLIF(e->>'reference_id', '')::uuid,
      NULLIF(e->>'note', '')
    FROM jsonb_array_elements(COALESCE(p_product_events, '[]'::jsonb)) AS e
    ON CONFLICT DO NOTHING
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

  WITH ins AS (
    INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate)
    SELECT (e->>'user_id')::uuid, NULLIF(e->>'bean_id', '')::uuid, NULLIF(e->>'blend_id', '')::uuid,
           (e->>'delta_grams')::integer, e->>'event_type', NULLIF(e->>'reference_id', '')::uuid,
           e->>'note', COALESCE((e->>'is_estimate')::boolean, false)
    FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
    ON CONFLICT DO NOTHING
    RETURNING bean_id, blend_id, delta_grams
  ),
  call_net AS (
    SELECT bean_id, blend_id, SUM(delta_grams) AS call_grams
    FROM ins
    GROUP BY bean_id, blend_id
  )
  SELECT array_agg(DISTINCT bean_id) FILTER (WHERE bean_id IS NOT NULL AND call_grams < 0),
         array_agg(DISTINCT blend_id) FILTER (WHERE blend_id IS NOT NULL AND call_grams < 0)
    INTO v_beans, v_blends
  FROM call_net;

  IF v_products IS NOT NULL THEN
    SELECT pse.product_id, SUM(pse.delta_units)::integer
      INTO v_bad_id, v_bad_amount
    FROM product_stock_events pse
    WHERE pse.product_id = ANY (v_products)
    GROUP BY pse.product_id
    HAVING SUM(pse.delta_units) < 0
    LIMIT 1;

    IF v_bad_id IS NOT NULL THEN
      RAISE EXCEPTION 'insufficient_product_stock'
        USING ERRCODE = 'check_violation',
              DETAIL = format('product_id=%s balance_units=%s', v_bad_id, v_bad_amount);
    END IF;
  END IF;

  IF v_beans IS NOT NULL OR v_blends IS NOT NULL THEN
    SELECT COALESCE(rse.bean_id, rse.blend_id), SUM(rse.delta_grams)::integer
      INTO v_bad_id, v_bad_amount
    FROM roasted_stock_events rse
    WHERE rse.bean_id = ANY (COALESCE(v_beans, '{}'::uuid[]))
       OR rse.blend_id = ANY (COALESCE(v_blends, '{}'::uuid[]))
    GROUP BY rse.bean_id, rse.blend_id
    HAVING SUM(rse.delta_grams) < 0
    LIMIT 1;

    IF v_bad_id IS NOT NULL THEN
      RAISE EXCEPTION 'insufficient_roasted_stock'
        USING ERRCODE = 'check_violation',
              DETAIL = format('target_id=%s balance_grams=%s', v_bad_id, v_bad_amount);
    END IF;
  END IF;
END;
$function$;
