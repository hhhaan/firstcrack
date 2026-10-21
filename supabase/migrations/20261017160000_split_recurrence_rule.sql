-- Close a recurrence series and insert its successor in one transaction.
-- A failed insert rolls back the until change.

CREATE OR REPLACE FUNCTION public.split_recurrence_rule(
  p_rule_id uuid,
  p_from_date date,
  p_rule jsonb
)
RETURNS public.recurrence_rules
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_row public.recurrence_rules;
BEGIN
  SELECT user_id INTO v_user
  FROM public.recurrence_rules
  WHERE id = p_rule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recurrence rule not found' USING ERRCODE = 'P0002';
  END IF;

  IF (p_rule->>'user_id')::uuid IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.recurrence_rules
  SET "until" = p_from_date - 1,
      updated_at = now()
  WHERE id = p_rule_id;

  INSERT INTO public.recurrence_rules (
    rrule, dtstart, "until", status, user_id,
    machine_id, roast_profile_id, bean_id, blend_id,
    bean_name, green_lot, batch_size_kg, yield_pct,
    target_roasted_kg, notes, batch_type
  ) VALUES (
    p_rule->>'rrule',
    (p_rule->>'dtstart')::date,
    NULLIF(p_rule->>'until', '')::date,
    COALESCE(NULLIF(p_rule->>'status', ''), 'active'),
    v_user,
    NULLIF(p_rule->>'machine_id', ''),
    NULLIF(p_rule->>'roast_profile_id', '')::uuid,
    NULLIF(p_rule->>'bean_id', '')::uuid,
    NULLIF(p_rule->>'blend_id', '')::uuid,
    COALESCE(p_rule->>'bean_name', ''),
    COALESCE(p_rule->>'green_lot', ''),
    COALESCE((p_rule->>'batch_size_kg')::numeric, 0),
    COALESCE((p_rule->>'yield_pct')::numeric, 0),
    COALESCE((p_rule->>'target_roasted_kg')::numeric, 0),
    COALESCE(p_rule->>'notes', ''),
    COALESCE(p_rule->>'batch_type', '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.split_recurrence_rule(uuid, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.split_recurrence_rule(uuid, date, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.split_recurrence_rule(uuid, date, jsonb) TO authenticated;
