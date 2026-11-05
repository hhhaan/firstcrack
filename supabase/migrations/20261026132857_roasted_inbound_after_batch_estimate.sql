-- A batch roast_inbound is the estimate for sessions that did not exist yet
-- when the batch was completed. A session saved earlier is outside that row:
-- its later output is its own inbound (#917). A session created afterwards is
-- inside the estimate: a measured output takes that session's share out of the
-- batch row, and the last share deletes it. Another estimate is not added on
-- top. An existing session inbound is corrected in place (#894).

CREATE OR REPLACE FUNCTION upsert_roasted_inbound(
  p_session_id uuid, p_user_id uuid, p_grams integer, p_is_estimate boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bean_id uuid;
  v_blend_id uuid;
  v_batch_id uuid;
  v_session_at timestamptz;
  v_batch_event uuid;
  v_batch_at timestamptz;
  v_batch_grams integer;
  v_batch_estimate boolean;
  v_has_session boolean;
  v_batch_count integer;
  v_before integer;
  v_claimed integer;
  v_remaining integer;
  v_kept integer;
BEGIN
  IF p_grams <= 0 THEN RETURN; END IF;

  SELECT s.bean_id, COALESCE(s.blend_id, b.blend_id), s.plan_batch_id, s.created_at
    INTO v_bean_id, v_blend_id, v_batch_id, v_session_at
  FROM roast_sessions s
  LEFT JOIN roast_plan_batches b ON b.id = s.plan_batch_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_blend_id IS NOT NULL THEN
    v_bean_id := NULL;
  ELSIF v_bean_id IS NULL THEN
    RETURN;
  END IF;

  v_has_session := EXISTS (
    SELECT 1 FROM roasted_stock_events
    WHERE reference_id = p_session_id AND event_type = 'roast_inbound'
  );

  IF v_batch_id IS NOT NULL AND NOT v_has_session THEN
    SELECT id, created_at, delta_grams, is_estimate
      INTO v_batch_event, v_batch_at, v_batch_grams, v_batch_estimate
    FROM roasted_stock_events
    WHERE reference_id = v_batch_id AND event_type = 'roast_inbound'
    FOR UPDATE;

    v_has_session := EXISTS (
      SELECT 1 FROM roasted_stock_events
      WHERE reference_id = p_session_id AND event_type = 'roast_inbound'
    );

    IF v_batch_event IS NOT NULL AND NOT v_has_session AND v_session_at > v_batch_at THEN
      IF p_is_estimate OR NOT v_batch_estimate THEN
        RETURN;
      END IF;

      SELECT batch_count INTO v_batch_count
      FROM roast_plan_batches
      WHERE id = v_batch_id;

      SELECT count(*)::integer INTO v_before
      FROM roast_sessions
      WHERE plan_batch_id = v_batch_id
        AND created_at <= v_batch_at;

      SELECT count(*)::integer INTO v_claimed
      FROM roast_sessions s
      WHERE s.plan_batch_id = v_batch_id
        AND s.created_at > v_batch_at
        AND s.id <> p_session_id
        AND EXISTS (
          SELECT 1 FROM roasted_stock_events e
          WHERE e.reference_id = s.id AND e.event_type = 'roast_inbound'
        );

      v_remaining := COALESCE(v_batch_count, 0) - COALESCE(v_before, 0) - COALESCE(v_claimed, 0);

      IF v_remaining = 1 THEN
        DELETE FROM roasted_stock_events WHERE id = v_batch_event;
      ELSIF v_remaining > 1 THEN
        v_kept := round(v_batch_grams::numeric * (v_remaining - 1) / v_remaining)::integer;
        IF v_kept <= 0 THEN
          DELETE FROM roasted_stock_events WHERE id = v_batch_event;
        ELSE
          UPDATE roasted_stock_events SET delta_grams = v_kept WHERE id = v_batch_event;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO roasted_stock_events (
    user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by
  ) VALUES (
    p_user_id, v_bean_id, v_blend_id, p_grams, 'roast_inbound', p_session_id, p_is_estimate, auth.uid()
  )
  ON CONFLICT (reference_id) WHERE event_type = 'roast_inbound'
  DO UPDATE SET delta_grams = EXCLUDED.delta_grams, is_estimate = EXCLUDED.is_estimate;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_roasted_inbound(uuid, uuid, integer, boolean) TO authenticated;
