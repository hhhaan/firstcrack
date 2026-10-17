-- #889 / #891: lock product or plan-batch parents before balance checks; atomic batch complete.
-- Stacked on 20261017120000_channel_orders_stock_hold.sql.
-- Legacy clients still call insert_stock_events_batch with plan_batch reference — clamp to server remaining grams.

-- ---------------------------------------------------------------------------
-- Parent-row locks (deterministic ORDER BY id within each table)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lock_products_for_stock(p_product_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
    RETURN;
  END IF;
  PERFORM 1
  FROM products p
  WHERE p.id = ANY (p_product_ids)
  ORDER BY p.id
  FOR UPDATE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lock_roasted_stock_parents(p_bean_ids uuid[], p_blend_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF p_bean_ids IS NOT NULL AND cardinality(p_bean_ids) > 0 THEN
    PERFORM 1 FROM beans b WHERE b.id = ANY (p_bean_ids) ORDER BY b.id FOR UPDATE;
  END IF;
  IF p_blend_ids IS NOT NULL AND cardinality(p_blend_ids) > 0 THEN
    PERFORM 1 FROM blends bl WHERE bl.id = ANY (p_blend_ids) ORDER BY bl.id FOR UPDATE;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lock_roast_plan_batch_for_write(p_batch_id uuid)
RETURNS roast_plan_batches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_rule_id uuid;
  v_batch roast_plan_batches;
BEGIN
  SELECT recurrence_rule_id INTO v_rule_id
  FROM roast_plan_batches
  WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan batch not found';
  END IF;
  IF v_rule_id IS NOT NULL THEN
    PERFORM 1 FROM recurrence_rules WHERE id = v_rule_id FOR UPDATE;
  END IF;
  SELECT * INTO v_batch FROM roast_plan_batches WHERE id = p_batch_id FOR UPDATE;
  RETURN v_batch;
END;
$function$;

CREATE OR REPLACE FUNCTION public.plan_batch_remaining_roast_grams(p_batch_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT GREATEST(
    0,
    (
      SELECT (
        GREATEST(0, b.batch_count - COALESCE(s.cnt, 0))
        * round(b.batch_size_kg * 1000)
      )::integer
      FROM roast_plan_batches b
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS cnt
        FROM roast_sessions rs
        WHERE rs.plan_batch_id = b.id
      ) s ON true
      WHERE b.id = p_batch_id
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.lock_products_for_stock(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lock_roasted_stock_parents(uuid[], uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lock_roast_plan_batch_for_write(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.plan_batch_remaining_roast_grams(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_products_for_stock(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_roasted_stock_parents(uuid[], uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_roast_plan_batch_for_write(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plan_batch_remaining_roast_grams(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fulfillment insert: product locks before deduct
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.insert_active_order_fulfillment_events(
  p_order_id uuid,
  p_skip_already_fulfilled boolean DEFAULT false
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.lock_products_for_stock((
    SELECT array_agg(DISTINCT ol.product_id)
    FROM order_lines ol
    WHERE ol.order_id = p_order_id
      AND ol.status = 'active'
      AND ol.product_id IS NOT NULL
  ));

  RETURN QUERY
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, created_by)
  SELECT ol.user_id, ol.product_id, -ol.quantity, 'order_fulfillment', ol.id, auth.uid()
  FROM order_lines ol
  WHERE ol.order_id = p_order_id
    AND ol.status = 'active'
    AND ol.product_id IS NOT NULL
    AND (
      NOT p_skip_already_fulfilled
      OR NOT EXISTS (
        SELECT 1 FROM product_stock_events pse
        WHERE pse.reference_id = ol.id AND pse.event_type = 'order_fulfillment'
      )
    )
  ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING
  RETURNING product_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- insert_product_stock_events_batch: lock products after order locks
-- ---------------------------------------------------------------------------

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

  PERFORM public.lock_products_for_stock((
    SELECT array_agg(DISTINCT (e->>'product_id')::uuid)
    FROM jsonb_array_elements(p_events) AS e
    WHERE NULLIF(e->>'product_id', '') IS NOT NULL
  ));

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

-- ---------------------------------------------------------------------------
-- insert_packaging_op: lock products, beans, blends before inserts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.insert_packaging_op(p_product_events jsonb, p_roasted_events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_products    uuid[];
  v_beans       uuid[];
  v_blends      uuid[];
  v_bad_id      uuid;
  v_bad_amount  integer;
BEGIN
  PERFORM public.lock_products_for_stock((
    SELECT array_agg(DISTINCT (e->>'product_id')::uuid)
    FROM jsonb_array_elements(p_product_events) AS e
    WHERE NULLIF(e->>'product_id', '') IS NOT NULL
  ));
  PERFORM public.lock_roasted_stock_parents(
    (
      SELECT array_agg(DISTINCT (e->>'bean_id')::uuid)
      FROM jsonb_array_elements(p_roasted_events) AS e
      WHERE NULLIF(e->>'bean_id', '') IS NOT NULL
    ),
    (
      SELECT array_agg(DISTINCT (e->>'blend_id')::uuid)
      FROM jsonb_array_elements(p_roasted_events) AS e
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
    FROM jsonb_array_elements(p_product_events) AS e
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

-- ---------------------------------------------------------------------------
-- insert_stock_events_batch: plan_batch roast clamp under batch lock (legacy complete path)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.clamp_roast_events_to_grams(p_events jsonb, p_cap integer)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_total integer := 0;
  v_scaled jsonb := '[]'::jsonb;
  v_other jsonb := '[]'::jsonb;
  v_roast jsonb;
  v_elem jsonb;
  v_abs integer;
  v_allocated integer := 0;
  v_i integer := 0;
  v_n integer;
  v_grams integer;
BEGIN
  IF p_cap <= 0 THEN
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
      INTO v_other
    FROM jsonb_array_elements(p_events) AS e
    WHERE e->>'event_type' IS DISTINCT FROM 'roast';
    RETURN v_other;
  END IF;

  SELECT COALESCE(sum(abs((e->>'delta_grams')::integer)), 0)::integer
    INTO v_total
  FROM jsonb_array_elements(p_events) AS e
  WHERE e->>'event_type' = 'roast';

  SELECT COALESCE(jsonb_agg(e.elem ORDER BY e.bean_key), '[]'::jsonb)
    INTO v_roast
  FROM (
    SELECT e AS elem, COALESCE(e->>'bean_id', '') AS bean_key
    FROM jsonb_array_elements(p_events) AS e
    WHERE e->>'event_type' = 'roast'
  ) e;

  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
    INTO v_other
  FROM jsonb_array_elements(p_events) AS e
  WHERE e->>'event_type' IS DISTINCT FROM 'roast';

  IF v_total <= 0 OR v_total <= p_cap THEN
    RETURN p_events;
  END IF;

  v_n := jsonb_array_length(v_roast);
  FOR v_i IN 0..(v_n - 1) LOOP
    v_elem := v_roast->v_i;
    v_abs := abs((v_elem->>'delta_grams')::integer);
    IF v_i = v_n - 1 THEN
      v_grams := p_cap - v_allocated;
    ELSE
      v_grams := round(v_abs::numeric * p_cap / v_total)::integer;
    END IF;
    v_allocated := v_allocated + v_grams;
    v_scaled := v_scaled || jsonb_build_array(
      v_elem || jsonb_build_object('delta_grams', -GREATEST(v_grams, 0))
    );
  END LOOP;

  RETURN v_other || v_scaled;
END;
$function$;

CREATE OR REPLACE FUNCTION insert_stock_events_batch(
  p_events jsonb,
  p_roasted_events jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_ref uuid;
  v_has_roast boolean;
  v_events jsonb := p_events;
  v_remaining integer;
  v_user_id uuid;
  v_batch roast_plan_batches;
  v_owner uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) AS e
    WHERE e->>'event_type' = 'roast'
  ) INTO v_has_roast;

  IF v_has_roast THEN
    SELECT NULLIF(e->>'reference_id', '')::uuid INTO v_ref
    FROM jsonb_array_elements(p_events) AS e
    WHERE e->>'event_type' = 'roast'
    LIMIT 1;

    IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM roast_plan_batches WHERE id = v_ref) THEN
      SELECT (e->>'user_id')::uuid INTO v_user_id
      FROM jsonb_array_elements(p_events) AS e LIMIT 1;
      IF v_user_id IS NULL OR NOT public.has_workspace_access(v_user_id) THEN
        RAISE EXCEPTION 'workspace access denied';
      END IF;
      v_batch := public.lock_roast_plan_batch_for_write(v_ref);
      SELECT user_id INTO v_owner FROM roast_day_plans WHERE id = v_batch.plan_id;
      IF v_owner IS DISTINCT FROM v_user_id AND NOT public.has_workspace_access(v_owner) THEN
        RAISE EXCEPTION 'plan batch owner mismatch';
      END IF;
      IF public.roast_deduction_blocked(v_ref) THEN
        SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_events
        FROM jsonb_array_elements(p_events) AS e
        WHERE e->>'event_type' IS DISTINCT FROM 'roast';
      ELSE
        v_remaining := public.plan_batch_remaining_roast_grams(v_ref);
        v_events := public.clamp_roast_events_to_grams(p_events, v_remaining);
      END IF;
    ELSIF v_ref IS NOT NULL AND public.roast_deduction_blocked(v_ref) THEN
      RAISE EXCEPTION 'roast_already_deducted'
        USING ERRCODE = 'unique_violation',
              DETAIL = format('reference_id=%s', v_ref);
    END IF;
  END IF;

  INSERT INTO bean_stock_events (user_id, bean_id, delta_grams, event_type, reference_id, note, created_by)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'bean_id')::uuid,
    (e->>'delta_grams')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', ''),
    COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid())
  FROM jsonb_array_elements(v_events) AS e
  WHERE (e->>'event_type') = 'roast'
    AND COALESCE((e->>'delta_grams')::integer, 0) <> 0
  ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;

  INSERT INTO bean_stock_events (user_id, bean_id, delta_grams, event_type, reference_id, note, created_by)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'bean_id')::uuid,
    (e->>'delta_grams')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', ''),
    COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid())
  FROM jsonb_array_elements(v_events) AS e
  WHERE e->>'event_type' IS DISTINCT FROM 'roast'
  ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by)
  SELECT
    (e->>'user_id')::uuid,
    NULLIF(e->>'bean_id', '')::uuid,
    NULLIF(e->>'blend_id', '')::uuid,
    (e->>'delta_grams')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    COALESCE((e->>'is_estimate')::boolean, false),
    auth.uid()
  FROM jsonb_array_elements(p_roasted_events) AS e
  ON CONFLICT DO NOTHING;
END;
$function$;

-- ---------------------------------------------------------------------------
-- complete_plan_batch: remaining grams + status in one transaction
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_plan_batch(p_batch_id uuid, p_deduct boolean DEFAULT true)
RETURNS roast_plan_batches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
  v_batch roast_plan_batches;
  v_rule_id uuid;
  v_rule recurrence_rules;
  v_remaining integer;
  v_grams integer;
  v_inbound integer;
  v_blend_id uuid;
  v_blend_name text;
  v_comp record;
  v_count integer;
  v_i integer := 0;
  v_allocated integer := 0;
  v_comp_grams integer;
BEGIN
  v_batch := public.lock_roast_plan_batch_for_write(p_batch_id);
  SELECT user_id INTO v_user_id FROM roast_day_plans WHERE id = v_batch.plan_id FOR SHARE;
  IF v_user_id IS NULL OR NOT public.has_workspace_access(v_user_id) THEN
    RAISE EXCEPTION 'workspace access denied';
  END IF;
  IF v_batch.exception_type = 'cancelled' OR v_batch.status = 'cancelled' THEN
    RAISE EXCEPTION 'plan batch cancelled';
  END IF;
  v_rule_id := v_batch.recurrence_rule_id;
  IF v_rule_id IS NOT NULL THEN
    SELECT * INTO v_rule FROM recurrence_rules WHERE id = v_rule_id;
    IF v_rule.user_id IS DISTINCT FROM v_user_id OR v_rule.status <> 'active'
       OR v_batch.original_date IS NULL OR v_batch.original_date < v_rule.dtstart
       OR (v_rule.until IS NOT NULL AND v_batch.original_date > v_rule.until) THEN
      RAISE EXCEPTION 'plan recurrence cancelled or ended';
    END IF;
  END IF;

  IF NOT COALESCE(p_deduct, false) OR (v_batch.bean_id IS NULL AND v_batch.blend_id IS NULL) THEN
    UPDATE roast_plan_batches SET status = 'done', updated_at = now()
    WHERE id = p_batch_id;
    SELECT * INTO v_batch FROM roast_plan_batches WHERE id = p_batch_id;
    RETURN v_batch;
  END IF;

  IF public.roast_deduction_blocked(p_batch_id) THEN
    UPDATE roast_plan_batches SET status = 'done', updated_at = now()
    WHERE id = p_batch_id AND status <> 'done';
    SELECT * INTO v_batch FROM roast_plan_batches WHERE id = p_batch_id;
    RETURN v_batch;
  END IF;

  v_remaining := public.plan_batch_remaining_roast_grams(p_batch_id);
  v_grams := v_remaining;
  v_blend_id := v_batch.blend_id;

  IF v_grams > 0 THEN
    IF v_blend_id IS NOT NULL THEN
      SELECT count(*)::int INTO v_count FROM blend_components WHERE blend_id = v_blend_id;
      IF v_count = 0 THEN
        RAISE EXCEPTION 'blend has no components';
      END IF;
      SELECT name INTO v_blend_name FROM blends WHERE id = v_blend_id;
      FOR v_comp IN
        SELECT bean_id, ratio_pct FROM blend_components
        WHERE blend_id = v_blend_id
        ORDER BY bean_id
      LOOP
        v_i := v_i + 1;
        IF v_i = v_count THEN
          v_comp_grams := v_grams - v_allocated;
        ELSE
          v_comp_grams := round(v_grams * (v_comp.ratio_pct / 100.0))::integer;
        END IF;
        v_allocated := v_allocated + v_comp_grams;
        IF v_comp_grams > 0 THEN
          INSERT INTO bean_stock_events (
            user_id, bean_id, delta_grams, event_type, reference_id, note, created_by
          ) VALUES (
            v_user_id, v_comp.bean_id, -v_comp_grams, 'roast', p_batch_id,
            COALESCE(v_blend_name, 'blend') || ' 블렌드 차감', auth.uid()
          )
          ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
        END IF;
      END LOOP;
    ELSIF v_batch.bean_id IS NOT NULL THEN
      INSERT INTO bean_stock_events (
        user_id, bean_id, delta_grams, event_type, reference_id, created_by
      ) VALUES (
        v_user_id, v_batch.bean_id, -v_grams, 'roast', p_batch_id, auth.uid()
      )
      ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;

    v_inbound := round(v_grams * 0.82)::integer;
    IF v_inbound > 0 THEN
      INSERT INTO roasted_stock_events (
        user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by
      ) VALUES (
        v_user_id,
        CASE WHEN v_blend_id IS NOT NULL THEN NULL ELSE v_batch.bean_id END,
        v_blend_id,
        v_inbound,
        'roast_inbound',
        p_batch_id,
        true,
        auth.uid()
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  UPDATE roast_plan_batches SET status = 'done', updated_at = now()
  WHERE id = p_batch_id;
  SELECT * INTO v_batch FROM roast_plan_batches WHERE id = p_batch_id;
  RETURN v_batch;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_plan_batch(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_plan_batch(uuid, boolean) TO authenticated, service_role;
