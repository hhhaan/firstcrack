-- #736 D2: atomic invite scorecard batch writes.

CREATE OR REPLACE FUNCTION public.write_cupping_scorecards_batch(
  p_invite_id uuid,
  p_participant_id uuid,
  p_cupped_by text,
  p_publish boolean,
  p_cards jsonb
)
RETURNS TABLE (
  id uuid,
  sample_id uuid,
  total_score numeric,
  cupped_at timestamptz,
  created boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_invite public.cupping_invites%ROWTYPE;
  v_participant public.cupping_participants%ROWTYPE;
  v_card_count integer;
BEGIN
  IF jsonb_typeof(p_cards) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'cards must be an array' USING ERRCODE = '22023';
  END IF;
  IF btrim(COALESCE(p_cupped_by, '')) = '' THEN
    RAISE EXCEPTION 'cupped_by is required' USING ERRCODE = '22023';
  END IF;
  IF p_publish IS NULL THEN
    RAISE EXCEPTION 'publish flag is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invite
  FROM public.cupping_invites
  WHERE cupping_invites.id = p_invite_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_participant
  FROM public.cupping_participants
  WHERE cupping_participants.id = p_participant_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_participant.invite_id <> p_invite_id
     OR v_participant.user_id <> v_invite.user_id
     OR v_participant.cupped_by <> p_cupped_by THEN
    RAISE EXCEPTION 'participant does not belong to invite' USING ERRCODE = '22023';
  END IF;
  IF v_participant.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_published' USING ERRCODE = 'PT409';
  END IF;

  v_card_count := jsonb_array_length(p_cards);
  IF v_card_count = 0 THEN
    RETURN;
  END IF;

  IF v_card_count <> (
    SELECT COUNT(DISTINCT (card->>'sample_id')::uuid)
    FROM jsonb_array_elements(p_cards) AS card
  ) THEN
    RAISE EXCEPTION 'card sample ids must be non-null and unique' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_cards) AS card
    LEFT JOIN public.cupping_samples AS s ON s.id = (card->>'sample_id')::uuid
    LEFT JOIN public.roast_sessions AS rs
      ON rs.id = COALESCE(s.roast_session_id, v_invite.roast_session_id)
    LEFT JOIN public.roast_profiles AS rp ON rp.id = rs.profile_id
    WHERE s.id IS NULL
       OR s.user_id <> v_invite.user_id
       OR CASE
            WHEN v_invite.event_id IS NOT NULL THEN s.event_id IS DISTINCT FROM v_invite.event_id
            ELSE s.id IS DISTINCT FROM v_invite.sample_id
          END
       OR (card ? 'roast_session_id' AND (card->>'roast_session_id')::uuid
             IS DISTINCT FROM COALESCE(s.roast_session_id, v_invite.roast_session_id))
       OR (COALESCE(s.roast_session_id, v_invite.roast_session_id) IS NOT NULL
             AND (rs.id IS NULL OR rs.user_id <> v_invite.user_id))
       OR (rs.profile_id IS NOT NULL AND (rp.id IS NULL OR rp.user_id <> v_invite.user_id))
  ) THEN
    RAISE EXCEPTION 'card does not belong to invite owner and scope' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH input AS (
    SELECT
      ordinality,
      (card->>'sample_id')::uuid AS sample_id,
      card->'scores' AS scores,
      (card->>'total_score')::numeric AS total_score,
      COALESCE((card->>'defects')::integer, 0) AS defects,
      card->>'notes' AS notes,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(card->'descriptors', '[]'::jsonb))) AS descriptors,
      COALESCE(card->>'form_version', 'sca_v1') AS form_version
    FROM jsonb_array_elements(p_cards) WITH ORDINALITY AS value(card, ordinality)
  ), resolved AS (
    SELECT i.*, COALESCE(s.roast_session_id, v_invite.roast_session_id) AS roast_session_id,
      rs.profile_id AS roast_profile_id
    FROM input AS i
    JOIN public.cupping_samples AS s ON s.id = i.sample_id
    LEFT JOIN public.roast_sessions AS rs ON rs.id = COALESCE(s.roast_session_id, v_invite.roast_session_id)
  ), updated AS (
    UPDATE public.cuppings AS c
    SET roast_session_id = r.roast_session_id,
        roast_profile_id = r.roast_profile_id,
        scores = r.scores,
        total_score = r.total_score,
        defects = r.defects,
        notes = r.notes,
        descriptors = r.descriptors,
        form_version = r.form_version,
        updated_at = now()
    FROM resolved AS r
    WHERE c.invite_id = p_invite_id
      AND c.sample_id = r.sample_id
      AND COALESCE(c.cupped_by, '') = COALESCE(p_cupped_by, '')
    RETURNING c.id, c.sample_id, c.total_score, c.cupped_at
  ), inserted AS (
    INSERT INTO public.cuppings (
      user_id, roast_session_id, roast_profile_id, scores, total_score, defects, notes,
      descriptors, source, invite_id, sample_id, cupped_by, form_version
    )
    SELECT
      v_invite.user_id, r.roast_session_id, r.roast_profile_id, r.scores, r.total_score,
      r.defects, r.notes, r.descriptors, 'invite', p_invite_id, r.sample_id,
      p_cupped_by, r.form_version
    FROM resolved AS r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cuppings AS c
      WHERE c.invite_id = p_invite_id
        AND c.sample_id = r.sample_id
        AND COALESCE(c.cupped_by, '') = COALESCE(p_cupped_by, '')
    )
    RETURNING cuppings.id, cuppings.sample_id, cuppings.total_score, cuppings.cupped_at
  ), written AS (
    SELECT u.id, u.sample_id, u.total_score, u.cupped_at, false AS created FROM updated AS u
    UNION ALL
    SELECT n.id, n.sample_id, n.total_score, n.cupped_at, true AS created FROM inserted AS n
  )
  SELECT w.id, w.sample_id, w.total_score, w.cupped_at, w.created
  FROM input AS i
  JOIN written AS w USING (sample_id)
  ORDER BY i.ordinality;

  IF p_publish THEN
    UPDATE public.cupping_participants
    SET published_at = now()
    WHERE cupping_participants.id = p_participant_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.write_cupping_scorecards_batch(uuid, uuid, text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_cupping_scorecards_batch(uuid, uuid, text, boolean, jsonb) TO service_role;
