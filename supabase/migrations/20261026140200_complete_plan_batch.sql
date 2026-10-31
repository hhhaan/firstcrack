-- #891: remaining green for a batch complete is counted under the same batch lock
-- save_roast_op takes. Session rows that already committed are not deducted again.
-- Status and the remainder events commit together.

CREATE OR REPLACE FUNCTION public.complete_plan_batch(p_batch_id uuid, p_deduct boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rule_id uuid;
  v_batch roast_plan_batches;
  v_owner uuid;
  v_sessions integer;
  v_remaining integer;
  v_grams integer;
  v_inbound integer;
  v_blend_id uuid;
  v_bean_id uuid;
  v_blend_name text;
  v_count integer;
  v_comp record;
  v_i integer := 0;
  v_allocated integer := 0;
  v_share integer;
BEGIN
  SELECT recurrence_rule_id INTO v_rule_id
  FROM roast_plan_batches
  WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan batch not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_rule_id IS NOT NULL THEN
    PERFORM 1 FROM recurrence_rules WHERE id = v_rule_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'plan recurrence not found' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  SELECT * INTO v_batch
  FROM roast_plan_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan batch not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_batch.recurrence_rule_id IS DISTINCT FROM v_rule_id THEN
    RAISE EXCEPTION 'plan recurrence changed; retry required' USING ERRCODE = '40001';
  END IF;

  SELECT user_id INTO v_owner FROM roast_day_plans WHERE id = v_batch.plan_id FOR SHARE;
  IF v_owner IS NULL OR NOT public.has_workspace_access(v_owner) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_batch.exception_type = 'cancelled' THEN
    RAISE EXCEPTION 'plan batch cancelled' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_deduct, false)
     AND (v_batch.bean_id IS NOT NULL OR v_batch.blend_id IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1 FROM bean_stock_events
       WHERE reference_id = p_batch_id AND event_type = 'roast'
     )
  THEN
    SELECT count(*)::integer INTO v_sessions
    FROM roast_sessions
    WHERE plan_batch_id = p_batch_id;

    v_remaining := GREATEST(0, COALESCE(v_batch.batch_count, 0) - COALESCE(v_sessions, 0));
    v_grams := round(v_remaining * v_batch.batch_size_kg * 1000)::integer;

    IF v_grams > 0 THEN
      v_blend_id := v_batch.blend_id;
      v_bean_id := v_batch.bean_id;

      IF v_blend_id IS NOT NULL THEN
        SELECT count(*)::integer INTO v_count
        FROM blend_components
        WHERE blend_id = v_blend_id;
        IF v_count = 0 THEN
          RAISE EXCEPTION 'blend has no components' USING ERRCODE = '23514';
        END IF;
        SELECT name INTO v_blend_name FROM blends WHERE id = v_blend_id;

        FOR v_comp IN
          SELECT bean_id, ratio_pct
          FROM blend_components
          WHERE blend_id = v_blend_id
          ORDER BY bean_id
        LOOP
          v_i := v_i + 1;
          IF v_i = v_count THEN
            v_share := v_grams - v_allocated;
          ELSE
            v_share := round(v_grams * (v_comp.ratio_pct / 100.0))::integer;
          END IF;
          v_allocated := v_allocated + v_share;
          IF v_share > 0 THEN
            INSERT INTO bean_stock_events (
              user_id, bean_id, delta_grams, event_type, reference_id, note, created_by
            ) VALUES (
              v_owner, v_comp.bean_id, -v_share, 'roast', p_batch_id,
              COALESCE(v_blend_name, 'blend') || ' 블렌드 차감',
              auth.uid()
            )
            ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
          END IF;
        END LOOP;
      ELSIF v_bean_id IS NOT NULL THEN
        INSERT INTO bean_stock_events (
          user_id, bean_id, delta_grams, event_type, reference_id, created_by
        ) VALUES (
          v_owner, v_bean_id, -v_grams, 'roast', p_batch_id, auth.uid()
        )
        ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
      END IF;

      v_inbound := round(v_grams * 0.82)::integer;
      IF v_inbound > 0 THEN
        INSERT INTO roasted_stock_events (
          user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by
        ) VALUES (
          v_owner,
          CASE WHEN v_blend_id IS NOT NULL THEN NULL ELSE v_bean_id END,
          v_blend_id,
          v_inbound,
          'roast_inbound',
          p_batch_id,
          true,
          auth.uid()
        )
        ON CONFLICT (reference_id) WHERE event_type = 'roast_inbound' DO NOTHING;
      END IF;
    END IF;
  END IF;

  UPDATE roast_plan_batches
  SET status = 'done'
  WHERE id = p_batch_id
    AND exception_type IS DISTINCT FROM 'cancelled'
    AND status IS DISTINCT FROM 'done';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_plan_batch(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_plan_batch(uuid, boolean) TO authenticated;
