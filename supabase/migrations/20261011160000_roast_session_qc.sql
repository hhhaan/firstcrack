-- Roast QC measurements entered from History after the batch is saved.
-- moisture / density are per roast, not bean-lot fields. null = not recorded.
-- Charge edits go through set_session_charge_weight so session-owned green
-- deductions stay equal to weight_grams. A batch-level deduct (reference_id =
-- plan_batch) is a different ledger row and is left alone.

alter table public.roast_sessions
    add column if not exists moisture_pct numeric(4,1),
    add column if not exists density_g_per_l numeric(6,1);

alter table public.roast_sessions
    drop constraint if exists roast_sessions_moisture_pct_check;

alter table public.roast_sessions
    add constraint roast_sessions_moisture_pct_check
    check (moisture_pct is null or (moisture_pct >= 0 and moisture_pct <= 100));

alter table public.roast_sessions
    drop constraint if exists roast_sessions_density_g_per_l_check;

alter table public.roast_sessions
    add constraint roast_sessions_density_g_per_l_check
    check (density_g_per_l is null or (density_g_per_l > 0 and density_g_per_l <= 2000));

comment on column public.roast_sessions.moisture_pct is '수분율(%). 히스토리 QC 수동 입력. null이면 미기록';
comment on column public.roast_sessions.density_g_per_l is '밀도(g/L). 히스토리 QC 수동 입력. null이면 미기록';

-- 500kg matches MAX_BATCH_WEIGHT_KG in roastSummarySchema.ts.
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
  IF p_weight_grams IS NULL OR p_weight_grams <= 0 OR p_weight_grams > 500000 THEN
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
