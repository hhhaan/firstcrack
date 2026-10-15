-- #840 manual order: idempotent create_order when (user_id, platform, platform_order_id) already exists.
-- Retries with the same platform_order_id return the existing order id without duplicating lines.

CREATE OR REPLACE FUNCTION public.create_order(p_order jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_order_id uuid;
  v_user_id  uuid;
  v_platform text;
  v_platform_order_id text;
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

  v_user_id := (p_order->>'user_id')::uuid;
  v_platform := coalesce(p_order->>'platform', 'manual');
  v_platform_order_id := coalesce(p_order->>'platform_order_id', gen_random_uuid()::text);

  INSERT INTO public.orders (
    user_id, platform, platform_order_id, status, ordered_at, buyer_name, currency, total_amount
  )
  VALUES (
    v_user_id,
    v_platform,
    v_platform_order_id,
    coalesce(p_order->>'status', 'paid'),
    coalesce((p_order->>'ordered_at')::timestamptz, now()),
    p_order->>'buyer_name',
    p_order->>'currency',
    (p_order->>'total_amount')::numeric
  )
  ON CONFLICT ON CONSTRAINT unique_platform_order DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT o.id
    INTO v_order_id
    FROM public.orders o
    WHERE o.user_id = v_user_id
      AND o.platform = v_platform
      AND o.platform_order_id = v_platform_order_id;

    IF v_order_id IS NOT NULL THEN
      RETURN v_order_id;
    END IF;

    RAISE EXCEPTION 'manual_order_conflict_not_visible'
      USING ERRCODE = 'check_violation';
  END IF;

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
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb) TO authenticated;
