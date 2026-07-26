-- #113 guard bug fix: corrective inbound self-lock
--
-- 20260801000003_order_stock_guards.sql checks post-insert balance < 0 for every
-- key touched by the call. Bug: a product already at -5 rejects a +3 corrective
-- inbound (post balance -2 < 0), so a positive event — the only way to repair a
-- negative ledger — is blocked.
--
-- Fix: the guard only inspects keys whose net delta FOR THIS CALL is negative.
-- Positive / zero net deltas always pass, regardless of pre-existing balance.
-- A deduction that leaves the balance negative still raises.
--
-- Design notes carried over from 20260801000003 (do not "simplify" away):
--   * CREATE OR REPLACE only — never DROP. Both functions are SECURITY INVOKER,
--     owner = postgres, proconfig = NULL, existing EXECUTE grants preserved
--     (fulfill_order: PUBLIC + authenticated + service_role; insert_packaging_op:
--     PUBLIC + authenticated). No GRANT / SET search_path re-issued here.
--   * Only rows actually inserted by THIS call (INSERT ... RETURNING) are guarded.
--     A replay hits ON CONFLICT DO NOTHING, returns no rows, stays an idempotent
--     success instead of tripping on pre-existing negatives.
--   * Balances reuse the existing ledger aggregation (SUM(delta_units) /
--     SUM(delta_grams)) — same sums as get_user_product_stock / get_user_roasted_stock.
--   * Stable snake_case error messages (insufficient_product_stock /
--     insufficient_roasted_stock) unchanged.
-- cancel_order is untouched (its restore deltas are always positive).

-- ---------------------------------------------------------------------------
-- fulfill_order: guard only products this call net-deducted
-- ---------------------------------------------------------------------------
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
  -- #109: serialize against cancel_order / concurrent fulfill of the same order
  SELECT o.status INTO v_status
  FROM orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found'
      USING ERRCODE = 'no_data_found',
            DETAIL = format('order_id=%s', p_order_id);
  END IF;

  -- #109: cancelled / refunded are terminal (status-map TERMINAL set) — fail closed, never deduct
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
    RETURNING product_id, delta_units
  ),
  call_net AS (
    SELECT product_id, SUM(delta_units) AS call_units
    FROM ins
    GROUP BY product_id
  )
  -- #113 fix: only products whose net delta in THIS call is negative
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

-- ---------------------------------------------------------------------------
-- insert_packaging_op: guard only keys this call net-deducted
-- (product +units / bulk roasted −units×net_weight in one transaction)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_packaging_op(p_product_events jsonb, p_roasted_events jsonb)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_products    uuid[];
  v_beans       uuid[];
  v_blends      uuid[];
  v_bad_id      uuid;
  v_bad_amount  integer;
BEGIN
  WITH ins AS (
    INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note)
    SELECT
      (e->>'user_id')::uuid,
      (e->>'product_id')::uuid,
      (e->>'delta_units')::integer,
      (e->>'event_type')::text,
      NULLIF(e->>'reference_id', '')::uuid,
      NULLIF(e->>'note', '')
    FROM jsonb_array_elements(p_product_events) AS e
    ON CONFLICT DO NOTHING
    RETURNING product_id, delta_units
  ),
  call_net AS (
    SELECT product_id, SUM(delta_units) AS call_units
    FROM ins
    GROUP BY product_id
  )
  -- #113 fix: only products whose net delta in THIS call is negative
  SELECT array_agg(product_id) FILTER (WHERE call_units < 0)
    INTO v_products
  FROM call_net;

  WITH ins AS (
    INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate)
    SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
           (e->>'delta_grams')::integer, e->>'event_type', (e->>'reference_id')::uuid,
           e->>'note', COALESCE((e->>'is_estimate')::boolean, false)
    FROM jsonb_array_elements(p_roasted_events) AS e
    ON CONFLICT DO NOTHING
    RETURNING bean_id, blend_id, delta_grams
  ),
  call_net AS (
    SELECT bean_id, blend_id, SUM(delta_grams) AS call_grams
    FROM ins
    GROUP BY bean_id, blend_id
  )
  -- #113 fix: only bean/blend keys whose net delta in THIS call is negative
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
