-- #736 D1: atomic reorder operations.

CREATE OR REPLACE FUNCTION public.reorder_plan_batches(
  p_plan_id uuid,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF COALESCE(cardinality(p_ordered_ids), 0) = 0 THEN
    RETURN;
  END IF;

  IF array_position(p_ordered_ids, NULL) IS NOT NULL
     OR cardinality(p_ordered_ids) <> (SELECT COUNT(DISTINCT id) FROM unnest(p_ordered_ids) AS id) THEN
    RAISE EXCEPTION 'ordered ids must be non-null and unique' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT id
    FROM public.roast_plan_batches
    WHERE plan_id = p_plan_id AND id = ANY(p_ordered_ids)
    ORDER BY id
    FOR UPDATE
  ) AS locked;

  IF v_count <> cardinality(p_ordered_ids) THEN
    RAISE EXCEPTION 'batch not found in plan' USING ERRCODE = '22023';
  END IF;

  UPDATE public.roast_plan_batches AS b
  SET order_index = x.ordinality::integer
  FROM unnest(p_ordered_ids) WITH ORDINALITY AS x(id, ordinality)
  WHERE b.id = x.id AND b.plan_id = p_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_plan_batches(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_plan_batches(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.reorder_cupping_samples(
  p_event_id uuid,
  p_ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF COALESCE(cardinality(p_ordered_ids), 0) = 0 THEN
    RETURN;
  END IF;

  IF array_position(p_ordered_ids, NULL) IS NOT NULL
     OR cardinality(p_ordered_ids) <> (SELECT COUNT(DISTINCT id) FROM unnest(p_ordered_ids) AS id) THEN
    RAISE EXCEPTION 'ordered ids must be non-null and unique' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT id
    FROM public.cupping_samples
    WHERE event_id = p_event_id AND id = ANY(p_ordered_ids)
    ORDER BY id
    FOR UPDATE
  ) AS locked;

  IF v_count <> cardinality(p_ordered_ids) THEN
    RAISE EXCEPTION 'sample not found in event' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cupping_samples AS s
  SET sort_order = (x.ordinality - 1)::integer
  FROM unnest(p_ordered_ids) WITH ORDINALITY AS x(id, ordinality)
  WHERE s.id = x.id AND s.event_id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_cupping_samples(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_cupping_samples(uuid, uuid[]) TO authenticated;

