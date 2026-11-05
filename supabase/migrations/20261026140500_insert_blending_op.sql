-- #897: blend output cannot exceed the input sum. The check runs before any insert.

CREATE OR REPLACE FUNCTION public.insert_blending_op(p_events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_input integer;
  v_output integer;
BEGIN
  SELECT
    COALESCE(SUM(-delta_grams) FILTER (WHERE event_type = 'blend_consume'), 0)::integer,
    COALESCE(SUM(delta_grams) FILTER (WHERE event_type = 'blend_produce'), 0)::integer
  INTO v_input, v_output
  FROM (
    SELECT (e->>'delta_grams')::integer AS delta_grams, e->>'event_type' AS event_type
    FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb)) AS e
  ) events;

  IF v_input <= 0 OR v_output <= 0 OR v_output > v_input THEN
    RAISE EXCEPTION 'blend_output_exceeds_input'
      USING ERRCODE = '23514',
            DETAIL = format('input_grams=%s output_grams=%s', v_input, v_output);
  END IF;

  PERFORM public.insert_roasted_stock_events_batch(p_events);
END;
$$;

REVOKE ALL ON FUNCTION public.insert_blending_op(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_blending_op(jsonb) TO authenticated;
