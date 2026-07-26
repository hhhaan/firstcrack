-- #109/#113 EF-path remainder: guard insert_product_stock_events_batch
--
-- The client RPCs (fulfill_order / cancel_order / insert_packaging_op) got row locks,
-- terminal-status and negative-stock guards in 20260801000003 + 20260802000000, but the
-- EF sync path (normalize.ts → insert_product_stock_events_batch) bypassed all of them:
-- channel auto-fulfill could deduct stock for a cancelled order and drive a ledger negative.
--
-- Semantics added here (mirroring fulfill_order):
--   * #109 lock  — every order referenced through an order-line event (reference_id →
--     order_lines.order_id) is locked FOR UPDATE, in deterministic id order, BEFORE its
--     status is read. Same lock fulfill_order / cancel_order take, so a concurrent client
--     cancel cannot interleave between the terminal check and the insert.
--   * #109 guard — an order_fulfillment event whose order is already cancelled/refunded is
--     SKIPPED (never inserted) and reported back to the caller instead of raising: one
--     poisoned line must not abort the rest of the batch, and silent skip is not acceptable
--     — normalize.ts logs the returned skips into the sync result. order_cancel restores
--     stay allowed (they compensate a prior fulfillment on a now-cancelled order).
--   * #113 guard — post-insert balance < 0 raises `insufficient_product_stock`, scoped to
--     keys whose net delta IN THIS CALL is negative (FILTER pattern from 20260802000000),
--     so positive corrective events pass regardless of a pre-existing negative balance.
--     Only rows actually inserted by THIS call are guarded (INSERT ... RETURNING); a replay
--     hits ON CONFLICT DO NOTHING and stays an idempotent success.
--
-- Return type changes void → jsonb ({"skipped": [...]}) — CREATE OR REPLACE cannot change
-- a return type, so this is the one place DROP + CREATE is required. DROP discards the old
-- ACL, so grants are re-issued below. Callers only check `error`, so the new return value
-- is backward-compatible. Function-only migration: regenerate database.types.ts at commit
-- time (rpc return type changed to Json).

DROP FUNCTION IF EXISTS public.insert_product_stock_events_batch(jsonb);

CREATE FUNCTION public.insert_product_stock_events_batch(p_events jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_products    uuid[];
  v_bad_product uuid;
  v_bad_units   integer;
  v_skipped     jsonb := '[]'::jsonb;
BEGIN
  -- #109: serialize against fulfill_order / cancel_order on every referenced order.
  -- Deterministic ORDER BY id avoids deadlocks between overlapping batches.
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

  -- #109: fulfillment against a terminal order → skip + report, never deduct.
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
  -- #113: only products whose net delta in THIS call is negative
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

-- DROP discarded the previous ACL (20260717000000 granted authenticated) — re-grant.
GRANT EXECUTE ON FUNCTION public.insert_product_stock_events_batch(jsonb) TO authenticated, service_role;
