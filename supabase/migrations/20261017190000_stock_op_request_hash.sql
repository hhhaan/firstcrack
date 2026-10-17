-- #892 / #893: bind idempotency keys to request content (stock_op_receipts + payload hash).
-- Stacked on 20261017160300_stock_concurrency_atomicity.sql — insert_packaging_op keeps PR-C locks.
-- Re-sync insert_packaging_op body from PR-C whenever that migration changes (receipt assert stays first).

-- ---------------------------------------------------------------------------
-- Receipt table
-- ---------------------------------------------------------------------------

CREATE TABLE public.stock_op_receipts (
  reference_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  op_kind text NOT NULL CHECK (op_kind IN ('packaging', 'bean_event')),
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_op_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stock_op_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.stock_op_receipts TO authenticated;

CREATE POLICY stock_op_receipts_select ON public.stock_op_receipts
  FOR SELECT
  USING (public.has_workspace_access(user_id));

CREATE POLICY stock_op_receipts_insert ON public.stock_op_receipts
  FOR INSERT
  WITH CHECK (public.has_workspace_access(user_id));

-- ---------------------------------------------------------------------------
-- Canonical payload hashes (note / created_by excluded)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.packaging_request_hash(p_product_events jsonb, p_roasted_events jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT md5(
    COALESCE((
      SELECT string_agg(
        COALESCE(e->>'product_id', '') || '|'
        || COALESCE(e->>'delta_units', '') || '|'
        || COALESCE(e->>'event_type', '') || '|'
        || COALESCE(NULLIF(e->>'reference_id', ''), ''),
        ';' ORDER BY
          COALESCE(e->>'product_id', ''),
          COALESCE(e->>'event_type', ''),
          (e->>'delta_units')::integer,
          COALESCE(NULLIF(e->>'reference_id', ''), '')
      )
      FROM jsonb_array_elements(COALESCE(p_product_events, '[]'::jsonb)) AS e
    ), '')
    || '|'
    || COALESCE((
      SELECT string_agg(
        COALESCE(NULLIF(e->>'bean_id', ''), '') || '|'
        || COALESCE(NULLIF(e->>'blend_id', ''), '') || '|'
        || COALESCE(e->>'delta_grams', '') || '|'
        || COALESCE(e->>'event_type', '') || '|'
        || COALESCE(NULLIF(e->>'reference_id', ''), ''),
        ';' ORDER BY
          COALESCE(NULLIF(e->>'bean_id', ''), ''),
          COALESCE(NULLIF(e->>'blend_id', ''), ''),
          COALESCE(e->>'event_type', ''),
          (e->>'delta_grams')::integer,
          COALESCE(NULLIF(e->>'reference_id', ''), '')
      )
      FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
    ), '')
  );
$function$;

CREATE OR REPLACE FUNCTION public.packaging_request_hash_from_ledger(p_reference_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT public.packaging_request_hash(
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', pse.product_id,
        'delta_units', pse.delta_units,
        'event_type', pse.event_type,
        'reference_id', pse.reference_id
      ) ORDER BY pse.product_id, pse.event_type, pse.delta_units, pse.reference_id)
      FROM product_stock_events pse
      WHERE pse.reference_id = p_reference_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bean_id', rse.bean_id,
        'blend_id', rse.blend_id,
        'delta_grams', rse.delta_grams,
        'event_type', rse.event_type,
        'reference_id', rse.reference_id
      ) ORDER BY rse.bean_id, rse.blend_id, rse.event_type, rse.delta_grams, rse.reference_id)
      FROM roasted_stock_events rse
      WHERE rse.reference_id = p_reference_id AND rse.event_type = 'packaging'
    ), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.bean_event_request_hash(p_event jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT md5(
    COALESCE(p_event->>'user_id', '') || '|'
    || COALESCE(p_event->>'bean_id', '') || '|'
    || COALESCE(p_event->>'delta_grams', '') || '|'
    || COALESCE(p_event->>'event_type', '') || '|'
    || COALESCE(
      CASE
        WHEN p_event->>'cost_per_kg' IS NULL OR p_event->>'cost_per_kg' = 'null' THEN ''
        ELSE trim_scale((p_event->>'cost_per_kg')::numeric)::text
      END,
      ''
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.bean_event_request_hash_from_ledger(p_reference_id uuid, p_bean_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT public.bean_event_request_hash(jsonb_build_object(
    'user_id', e.user_id,
    'bean_id', e.bean_id,
    'delta_grams', e.delta_grams,
    'event_type', e.event_type,
    'cost_per_kg', e.cost_per_kg
  ))
  FROM bean_stock_events e
  WHERE e.reference_id = p_reference_id AND e.bean_id = p_bean_id
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.packaging_request_hash_from_ledger(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bean_event_request_hash_from_ledger(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.packaging_request_hash_from_ledger(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bean_event_request_hash_from_ledger(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- assert_stock_op_receipt
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_stock_op_receipt(
  p_reference_id uuid,
  p_user_id uuid,
  p_op_kind text,
  p_request_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_row public.stock_op_receipts;
  v_legacy text;
  v_bean_id uuid;
BEGIN
  IF p_reference_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.stock_op_receipts (reference_id, user_id, op_kind, request_hash)
  VALUES (p_reference_id, p_user_id, p_op_kind, p_request_hash)
  ON CONFLICT (reference_id) DO NOTHING;

  SELECT * INTO v_row FROM public.stock_op_receipts WHERE reference_id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_op_receipt_missing' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.user_id IS DISTINCT FROM p_user_id
     OR v_row.op_kind IS DISTINCT FROM p_op_kind
     OR v_row.request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'idempotency_payload_mismatch'
      USING ERRCODE = 'P0001',
            DETAIL = format('reference_id=%s', p_reference_id);
  END IF;

  IF p_op_kind = 'packaging' THEN
    IF EXISTS (
      SELECT 1 FROM product_stock_events WHERE reference_id = p_reference_id
    ) OR EXISTS (
      SELECT 1 FROM roasted_stock_events
      WHERE reference_id = p_reference_id AND event_type = 'packaging'
    ) THEN
      v_legacy := public.packaging_request_hash_from_ledger(p_reference_id);
      IF v_legacy IS DISTINCT FROM p_request_hash THEN
        RAISE EXCEPTION 'idempotency_payload_mismatch'
          USING ERRCODE = 'P0001',
                DETAIL = format('reference_id=%s legacy_mismatch', p_reference_id);
      END IF;
    END IF;
  ELSIF p_op_kind = 'bean_event' THEN
    SELECT e.bean_id INTO v_bean_id
    FROM bean_stock_events e
    WHERE e.reference_id = p_reference_id
    LIMIT 1;
    IF v_bean_id IS NOT NULL THEN
      v_legacy := public.bean_event_request_hash_from_ledger(p_reference_id, v_bean_id);
      IF v_legacy IS DISTINCT FROM p_request_hash THEN
        RAISE EXCEPTION 'idempotency_payload_mismatch'
          USING ERRCODE = 'P0001',
                DETAIL = format('reference_id=%s legacy_mismatch', p_reference_id);
      END IF;
    END IF;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_stock_op_receipt(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.packaging_request_hash(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bean_event_request_hash(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_stock_op_receipt(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.packaging_request_hash(jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bean_event_request_hash(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- insert_bean_stock_event (purchase / adjust with client reference_id)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.insert_bean_stock_event(p_event jsonb)
RETURNS public.bean_stock_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_ref uuid;
  v_hash text;
  v_row public.bean_stock_events;
BEGIN
  v_ref := NULLIF(p_event->>'reference_id', '')::uuid;
  v_hash := public.bean_event_request_hash(p_event);

  PERFORM public.assert_stock_op_receipt(
    v_ref,
    (p_event->>'user_id')::uuid,
    'bean_event',
    v_hash
  );

  INSERT INTO bean_stock_events (
    user_id, bean_id, delta_grams, event_type, reference_id, note, cost_per_kg, created_by
  )
  VALUES (
    (p_event->>'user_id')::uuid,
    (p_event->>'bean_id')::uuid,
    (p_event->>'delta_grams')::integer,
    (p_event->>'event_type')::text,
    v_ref,
    NULLIF(p_event->>'note', ''),
    NULLIF(p_event->>'cost_per_kg', '')::numeric,
    COALESCE(NULLIF(p_event->>'created_by', '')::uuid, auth.uid())
  )
  ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND AND v_ref IS NOT NULL THEN
    SELECT * INTO v_row
    FROM bean_stock_events
    WHERE reference_id = v_ref AND bean_id = (p_event->>'bean_id')::uuid;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bean_stock_event_insert_failed';
  END IF;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.insert_bean_stock_event(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_bean_stock_event(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- insert_packaging_op: PR-C locks + receipt assert (same lock order as 17160300)
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
  v_ref         uuid;
  v_user_id     uuid;
  v_ref_count   integer;
  v_user_count  integer;
  v_hash        text;
BEGIN
  SELECT count(DISTINCT NULLIF(elem->>'reference_id', '')::uuid),
         count(DISTINCT (elem->>'user_id')::uuid)
    INTO v_ref_count, v_user_count
  FROM (
    SELECT e AS elem FROM jsonb_array_elements(p_product_events) AS e
    UNION ALL
    SELECT e AS elem FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
  ) q;

  IF v_ref_count > 1 OR v_user_count > 1 THEN
    RAISE EXCEPTION 'packaging_op_ambiguous_reference'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT NULLIF(e->>'reference_id', '')::uuid, (e->>'user_id')::uuid
    INTO v_ref, v_user_id
  FROM jsonb_array_elements(p_product_events) AS e
  LIMIT 1;

  IF v_ref IS NULL THEN
    SELECT NULLIF(e->>'reference_id', '')::uuid INTO v_ref
    FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
    LIMIT 1;
  END IF;
  IF v_user_id IS NULL THEN
    SELECT (e->>'user_id')::uuid INTO v_user_id
    FROM jsonb_array_elements(COALESCE(p_roasted_events, '[]'::jsonb)) AS e
    LIMIT 1;
  END IF;

  v_hash := public.packaging_request_hash(p_product_events, p_roasted_events);
  PERFORM public.assert_stock_op_receipt(v_ref, v_user_id, 'packaging', v_hash);

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
