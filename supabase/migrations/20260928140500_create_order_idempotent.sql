-- create_order: same workspace + platform + platform_order_id is idempotent.
--
-- A retry (lost response, double submit) returns the existing order id when the
-- payload this function writes still matches. It does not insert a second header
-- or more lines, and it does not update the stored row.
--
-- Equivalent payload, after the same coalescing as the insert:
--   header: status (default 'paid'), ordered_at (default now()), buyer_name,
--           currency, total_amount
--   lines:  platform_line_id, product_id, title (default ''), quantity, unit_price
-- Compared as a multiset (order of lines does not matter). timestamptz / numeric
-- equality, not text equality. Later fulfill / cancel / line edits are left as-is
-- when those written fields still match; they are not reverted. If a later edit
-- changed a compared field (for example status), the replay raises
-- order_key_payload_mismatch instead of overwriting.
--
-- A different payload under the same key raises order_key_payload_mismatch
-- (check_violation). The existing row is unchanged.
--
-- Idempotent replay needs a stable platform_order_id and each line's
-- platform_line_id. An omitted platform_order_id still mints a new id (not
-- idempotent). An omitted platform_line_id is stored as a fresh uuid on insert;
-- a replay that omits it cannot reproduce that uuid and mismatches.
--
-- SECURITY INVOKER so RLS still applies. has_workspace_access(user_id) is also
-- checked explicitly (same predicate as the orders policies) so the write is
-- refused for another workspace even when the caller bypasses RLS.
-- Concurrent same-key inserts: ON CONFLICT DO NOTHING, then re-read and apply
-- the same payload rule. A unique_violation that escapes ON CONFLICT (the
-- conflicting row is hidden by RLS) takes that re-read path instead of
-- surfacing as a duplicate-key error.

CREATE OR REPLACE FUNCTION public.create_order(p_order jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
  v_user_id uuid;
  v_platform text;
  v_platform_order_id text;
  v_status text;
  v_ordered_at timestamptz;
  v_buyer_name text;
  v_currency text;
  v_total_amount numeric;
  v_existing public.orders;
  v_existing_id uuid;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'order_lines_required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) l
    WHERE coalesce((l->>'quantity')::integer, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'order_line_quantity_invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  v_user_id := NULLIF(p_order->>'user_id', '')::uuid;
  IF v_user_id IS NULL OR NOT public.has_workspace_access(v_user_id) THEN
    RAISE EXCEPTION 'workspace access denied';
  END IF;

  v_platform := coalesce(p_order->>'platform', 'manual');
  v_platform_order_id := coalesce(p_order->>'platform_order_id', gen_random_uuid()::text);
  v_status := coalesce(p_order->>'status', 'paid');
  v_ordered_at := coalesce((p_order->>'ordered_at')::timestamptz, now());
  v_buyer_name := p_order->>'buyer_name';
  v_currency := p_order->>'currency';
  v_total_amount := (p_order->>'total_amount')::numeric;

  BEGIN
    INSERT INTO public.orders (
      user_id, platform, platform_order_id, status, ordered_at, buyer_name, currency, total_amount
    )
    VALUES (
      v_user_id,
      v_platform,
      v_platform_order_id,
      v_status,
      v_ordered_at,
      v_buyer_name,
      v_currency,
      v_total_amount
    )
    ON CONFLICT ON CONSTRAINT unique_platform_order DO NOTHING
    RETURNING id INTO v_order_id;
  EXCEPTION
    WHEN unique_violation THEN
      v_order_id := NULL;
  END;

  IF v_order_id IS NOT NULL THEN
    INSERT INTO public.order_lines (
      order_id, user_id, platform_line_id, product_id, title, quantity, unit_price
    )
    SELECT
      v_order_id,
      v_user_id,
      coalesce(l->>'platform_line_id', gen_random_uuid()::text),
      (l->>'product_id')::uuid,
      coalesce(l->>'title', ''),
      (l->>'quantity')::integer,
      (l->>'unit_price')::numeric
    FROM jsonb_array_elements(p_lines) l;

    RETURN v_order_id;
  END IF;

  SELECT * INTO v_existing
  FROM public.orders
  WHERE user_id = v_user_id
    AND platform = v_platform
    AND platform_order_id = v_platform_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_key_conflict'
      USING ERRCODE = 'unique_violation';
  END IF;

  v_existing_id := v_existing.id;
  -- Header fields are plpgsql comparisons. Line equality is a SQL multiset so a
  -- record field is not parsed as a table name.
  IF v_existing.status IS DISTINCT FROM v_status
    OR v_existing.ordered_at IS DISTINCT FROM v_ordered_at
    OR v_existing.buyer_name IS DISTINCT FROM v_buyer_name
    OR v_existing.currency IS DISTINCT FROM v_currency
    OR v_existing.total_amount IS DISTINCT FROM v_total_amount
    OR EXISTS (
      SELECT platform_line_id, product_id, title, quantity, unit_price
      FROM public.order_lines
      WHERE order_id = v_existing_id
      EXCEPT ALL
      SELECT
        coalesce(l->>'platform_line_id', ''),
        (l->>'product_id')::uuid,
        coalesce(l->>'title', ''),
        (l->>'quantity')::integer,
        (l->>'unit_price')::numeric
      FROM jsonb_array_elements(p_lines) l
    )
    OR EXISTS (
      SELECT
        coalesce(l->>'platform_line_id', ''),
        (l->>'product_id')::uuid,
        coalesce(l->>'title', ''),
        (l->>'quantity')::integer,
        (l->>'unit_price')::numeric
      FROM jsonb_array_elements(p_lines) l
      EXCEPT ALL
      SELECT platform_line_id, product_id, title, quantity, unit_price
      FROM public.order_lines
      WHERE order_id = v_existing_id
    )
  THEN
    RAISE EXCEPTION 'order_key_payload_mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_existing_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb) TO authenticated;
