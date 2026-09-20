-- Cupper seat + one-shot publish. Scores land in cuppings only on publish.
-- Authenticated clients may read seats; writes go through invite Edge Functions.

CREATE TABLE public.cupping_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.cupping_invites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cupped_by text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cupping_participants_cupped_by_len CHECK (char_length(btrim(cupped_by)) BETWEEN 1 AND 80),
  CONSTRAINT cupping_participants_invite_cupper_key UNIQUE (invite_id, cupped_by)
);

CREATE INDEX cupping_participants_invite_id_idx ON public.cupping_participants (invite_id);
CREATE INDEX cupping_participants_user_id_idx ON public.cupping_participants (user_id);

ALTER TABLE public.cupping_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace access cupping_participants"
  ON public.cupping_participants
  FOR SELECT
  USING (public.has_workspace_access(user_id));

GRANT SELECT ON public.cupping_participants TO authenticated;
GRANT ALL ON public.cupping_participants TO service_role;

COMMENT ON TABLE public.cupping_participants IS
  'Invite seat per cupper. published_at locks the sheet; cuppings rows are the scores.';

-- Legacy in-flight scores stay editable until the new client publishes.
INSERT INTO public.cupping_participants (invite_id, user_id, cupped_by, claimed_at, published_at)
SELECT
  c.invite_id,
  i.user_id,
  COALESCE(NULLIF(btrim(c.cupped_by), ''), 'Anonymous'),
  MIN(c.cupped_at),
  NULL
FROM public.cuppings c
JOIN public.cupping_invites i ON i.id = c.invite_id
WHERE c.invite_id IS NOT NULL
GROUP BY c.invite_id, i.user_id, COALESCE(NULLIF(btrim(c.cupped_by), ''), 'Anonymous')
ON CONFLICT (invite_id, cupped_by) DO NOTHING;

-- One scorecard per cupper × sample on an invite.
DELETE FROM public.cuppings
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY invite_id, sample_id, COALESCE(cupped_by, '')
        ORDER BY cupped_at DESC, id DESC
      ) AS rn
    FROM public.cuppings
    WHERE invite_id IS NOT NULL AND sample_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX cuppings_invite_sample_cupper_uidx
  ON public.cuppings (invite_id, sample_id, COALESCE(cupped_by, ''))
  WHERE invite_id IS NOT NULL AND sample_id IS NOT NULL;
