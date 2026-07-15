-- Cupping events (table day) + samples; invites/cuppings attach to sample

CREATE TABLE public.cupping_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  held_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cupping_events_user_id_idx ON public.cupping_events (user_id);
CREATE INDEX cupping_events_held_at_idx ON public.cupping_events (held_at DESC);

CREATE TABLE public.cupping_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.cupping_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  roast_session_id uuid REFERENCES public.roast_sessions(id) ON DELETE SET NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cupping_samples_event_id_idx ON public.cupping_samples (event_id);
CREATE INDEX cupping_samples_user_id_idx ON public.cupping_samples (user_id);
CREATE INDEX cupping_samples_roast_session_id_idx ON public.cupping_samples (roast_session_id);

ALTER TABLE public.cupping_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupping_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cupping events"
  ON public.cupping_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cupping events"
  ON public.cupping_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cupping events"
  ON public.cupping_events FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own cupping events"
  ON public.cupping_events FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own cupping samples"
  ON public.cupping_samples FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cupping samples"
  ON public.cupping_samples FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cupping samples"
  ON public.cupping_samples FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own cupping samples"
  ON public.cupping_samples FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupping_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupping_samples TO authenticated;
GRANT ALL ON public.cupping_events TO service_role;
GRANT ALL ON public.cupping_samples TO service_role;

-- Backfill: one event + sample per existing invite/cupping roast_session
-- (only if there is orphan data without samples)

-- Invites: add sample_id, make roast_session_id nullable
ALTER TABLE public.cupping_invites
  ADD COLUMN IF NOT EXISTS sample_id uuid REFERENCES public.cupping_samples(id) ON DELETE CASCADE;

ALTER TABLE public.cupping_invites
  ALTER COLUMN roast_session_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS cupping_invites_sample_id_idx ON public.cupping_invites (sample_id);

-- Cuppings: add sample_id, make roast_session_id nullable
ALTER TABLE public.cuppings
  ADD COLUMN IF NOT EXISTS sample_id uuid REFERENCES public.cupping_samples(id) ON DELETE CASCADE;

ALTER TABLE public.cuppings
  ALTER COLUMN roast_session_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS cuppings_sample_id_idx ON public.cuppings (sample_id);

-- Backfill samples for existing invite rows that lack sample_id
DO $$
DECLARE
  inv RECORD;
  v_event_id uuid;
  v_sample_id uuid;
  v_label text;
BEGIN
  FOR inv IN
    SELECT i.*
    FROM public.cupping_invites i
    WHERE i.sample_id IS NULL AND i.user_id IS NOT NULL
  LOOP
    v_label := COALESCE(inv.label, 'Sample');
    INSERT INTO public.cupping_events (user_id, title, held_at)
    VALUES (inv.user_id, 'Legacy cupping', inv.created_at)
    RETURNING id INTO v_event_id;

    INSERT INTO public.cupping_samples (event_id, user_id, roast_session_id, label, sort_order)
    VALUES (v_event_id, inv.user_id, inv.roast_session_id, v_label, 0)
    RETURNING id INTO v_sample_id;

    UPDATE public.cupping_invites SET sample_id = v_sample_id WHERE id = inv.id;
    UPDATE public.cuppings
      SET sample_id = v_sample_id
      WHERE invite_id = inv.id AND sample_id IS NULL;
  END LOOP;

  -- Cuppings without sample (owner path) still missing sample_id
  FOR inv IN
    SELECT c.*
    FROM public.cuppings c
    WHERE c.sample_id IS NULL
  LOOP
    INSERT INTO public.cupping_events (user_id, title, held_at)
    VALUES (inv.user_id, 'Legacy cupping', inv.cupped_at)
    RETURNING id INTO v_event_id;

    INSERT INTO public.cupping_samples (event_id, user_id, roast_session_id, label, sort_order)
    VALUES (v_event_id, inv.user_id, inv.roast_session_id, 'Sample', 0)
    RETURNING id INTO v_sample_id;

    UPDATE public.cuppings SET sample_id = v_sample_id WHERE id = inv.id;
  END LOOP;
END $$;
