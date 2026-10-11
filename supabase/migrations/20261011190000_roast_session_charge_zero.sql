-- History charge matches the summary: 0 is the unset weight, not NULL.
-- A roast ledger row must stay negative, so 0 does not rescale session-owned
-- green deductions. Those rows remain until a positive weight is saved again.
-- The estimated roasted inbound came from the old green weight, so it is removed.

CREATE OR REPLACE FUNCTION set_session_charge_weight(
  p_session_id uuid,
  p_weight_grams integer,
  p_inbound_grams integer,
  p_inbound_is_estimate boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_output integer;
  v_row record;
  v_ids uuid[] := '{}';
  v_olds integer[] := '{}';
  v_grams integer[] := '{}';
  v_frac numeric[] := '{}';
  v_count integer := 0;
  v_deducted integer := 0;
  v_allocated integer := 0;
  v_share integer;
  v_part numeric;
  v_rem integer;
  v_best integer;
  v_i integer;
BEGIN
  IF p_weight_grams IS NULL OR p_weight_grams < 0 OR p_weight_grams > 500000 THEN
    RAISE EXCEPTION 'invalid charge weight' USING ERRCODE = '23514';
  END IF;

  IF COALESCE(p_inbound_grams, 0) < 0 THEN
    RAISE EXCEPTION 'invalid inbound weight' USING ERRCODE = '23514';
  END IF;

  SELECT user_id, output_weight_grams
    INTO v_user_id, v_output
  FROM roast_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or access denied';
  END IF;

  IF v_output IS NOT NULL AND p_weight_grams < v_output THEN
    RAISE EXCEPTION 'charge below output' USING ERRCODE = '23514';
  END IF;

  UPDATE roast_sessions
  SET weight_grams = p_weight_grams
  WHERE id = p_session_id;

  IF p_weight_grams = 0 THEN
    DELETE FROM roasted_stock_events
    WHERE reference_id = p_session_id
      AND event_type = 'roast_inbound'
      AND is_estimate IS TRUE;
    RETURN;
  END IF;

  FOR v_row IN
    SELECT id, (-delta_grams) AS old_grams
    FROM bean_stock_events
    WHERE reference_id = p_session_id
      AND event_type = 'roast'
    ORDER BY bean_id
    FOR UPDATE
  LOOP
    v_count := v_count + 1;
    v_deducted := v_deducted + v_row.old_grams;
    v_ids := v_ids || v_row.id;
    v_olds := v_olds || v_row.old_grams;
  END LOOP;

  IF v_count > 0 AND v_deducted > 0 AND v_deducted IS DISTINCT FROM p_weight_grams THEN
    FOR v_i IN 1..v_count LOOP
      v_part := p_weight_grams::numeric * v_olds[v_i] / v_deducted;
      v_share := floor(v_part)::integer;
      v_grams := v_grams || v_share;
      v_frac := v_frac || (v_part - v_share);
      v_allocated := v_allocated + v_share;
    END LOOP;

    v_rem := p_weight_grams - v_allocated;
    IF v_rem < 0 OR v_rem >= v_count THEN
      RAISE EXCEPTION 'charge_weight_split' USING ERRCODE = '23514';
    END IF;

    WHILE v_rem > 0 LOOP
      v_best := 1;
      FOR v_i IN 2..v_count LOOP
        IF v_frac[v_i] > v_frac[v_best] THEN
          v_best := v_i;
        END IF;
      END LOOP;
      v_grams[v_best] := v_grams[v_best] + 1;
      v_frac[v_best] := -1;
      v_rem := v_rem - 1;
    END LOOP;

    FOR v_i IN 1..v_count LOOP
      IF v_grams[v_i] <= 0 THEN
        RAISE EXCEPTION 'charge_weight_split' USING ERRCODE = '23514';
      END IF;
    END LOOP;

    FOR v_i IN 1..v_count LOOP
      UPDATE bean_stock_events
      SET delta_grams = -v_grams[v_i]
      WHERE id = v_ids[v_i];
    END LOOP;
  END IF;

  IF COALESCE(p_inbound_grams, 0) > 0 THEN
    PERFORM upsert_roasted_inbound(
      p_session_id,
      v_user_id,
      p_inbound_grams,
      COALESCE(p_inbound_is_estimate, false)
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_session_charge_weight(uuid, integer, integer, boolean) TO authenticated;
