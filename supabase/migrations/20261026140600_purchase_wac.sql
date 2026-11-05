-- #898: weighted average cost over every purchase row, not one API page.

CREATE OR REPLACE FUNCTION public.get_purchase_wac(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_object_agg(priced.bean_id, priced.wac)
      FROM (
        SELECT
          e.bean_id,
          SUM(e.delta_grams::numeric * e.cost_per_kg) / SUM(e.delta_grams::numeric) AS wac
        FROM public.bean_stock_events e
        WHERE e.user_id = p_user_id
          AND e.event_type = 'purchase'
          AND e.cost_per_kg IS NOT NULL
          AND e.delta_grams > 0
        GROUP BY e.bean_id
        HAVING SUM(e.delta_grams) > 0
      ) priced
    ),
    '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_purchase_wac(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_wac(uuid) TO authenticated, service_role;
