-- Corrections derive inventory from the locked saved row, never a stale client estimate.
CREATE OR REPLACE FUNCTION refresh_session_roasted_inbound(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_session roast_sessions;
  v_grams integer;
  v_measured boolean;
BEGIN
  SELECT * INTO v_session FROM roast_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or access denied' USING ERRCODE = '42501';
  END IF;
  v_measured := COALESCE(v_session.output_weight_grams > 0, false);
  v_grams := CASE WHEN v_measured THEN v_session.output_weight_grams ELSE
    round(v_session.weight_grams * CASE v_session.roast_level
      WHEN 'Light' THEN 0.88 WHEN 'Medium-Light' THEN 0.865
      WHEN 'Medium' THEN 0.85 WHEN 'Medium-Dark' THEN 0.835 ELSE 0.82 END)::integer END;
  IF v_grams > 0 THEN
    PERFORM upsert_roasted_inbound(p_session_id, v_session.user_id, v_grams, NOT v_measured);
  ELSE
    DELETE FROM roasted_stock_events
    WHERE reference_id = p_session_id AND event_type = 'roast_inbound' AND is_estimate IS TRUE;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION correct_session_output_weight(p_session_id uuid, p_output_grams integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_charge integer;
BEGIN
  SELECT weight_grams INTO v_charge FROM roast_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or access denied' USING ERRCODE = '42501';
  END IF;
  IF p_output_grams IS NOT NULL AND (p_output_grams <= 0 OR p_output_grams > v_charge) THEN
    RAISE EXCEPTION 'invalid output weight' USING ERRCODE = '23514';
  END IF;
  UPDATE roast_sessions SET output_weight_grams = p_output_grams WHERE id = p_session_id;
  PERFORM refresh_session_roasted_inbound(p_session_id);
END;
$$;
CREATE OR REPLACE FUNCTION set_session_roast_level(p_session_id uuid, p_roast_level text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM roast_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or access denied' USING ERRCODE = '42501';
  END IF;
  UPDATE roast_sessions SET roast_level = p_roast_level WHERE id = p_session_id;
  -- A level correction must never rewrite measured stock.
  IF NOT EXISTS (SELECT 1 FROM roast_sessions WHERE id = p_session_id AND output_weight_grams > 0) THEN
    PERFORM refresh_session_roasted_inbound(p_session_id);
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION correct_session_charge_weight(
  p_session_id uuid,
  p_weight_grams integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
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

  SELECT output_weight_grams
    INTO v_output
  FROM roast_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or access denied' USING ERRCODE = '42501';
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

  PERFORM refresh_session_roasted_inbound(p_session_id);
END;
$$;
-- Compatibility for installed clients; their inventory estimates are no longer authoritative.
CREATE OR REPLACE FUNCTION set_session_output_weight(
  p_session_id uuid, p_output_grams integer, p_inbound_grams integer, p_inbound_is_estimate boolean
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT correct_session_output_weight(p_session_id, p_output_grams);
$$;
CREATE OR REPLACE FUNCTION set_session_charge_weight(
  p_session_id uuid, p_weight_grams integer, p_inbound_grams integer, p_inbound_is_estimate boolean
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT correct_session_charge_weight(p_session_id, p_weight_grams);
$$;
REVOKE ALL ON FUNCTION refresh_session_roasted_inbound(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION refresh_session_roasted_inbound(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION correct_session_output_weight(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION correct_session_output_weight(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION correct_session_charge_weight(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION correct_session_charge_weight(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION set_session_roast_level(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_session_roast_level(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION set_session_output_weight(uuid, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_session_output_weight(uuid, integer, integer, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION set_session_charge_weight(uuid, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_session_charge_weight(uuid, integer, integer, boolean) TO authenticated, service_role;
