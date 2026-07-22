-- Cupping sessions (invites) + results

CREATE TABLE public.cupping_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  roast_session_id uuid NOT NULL REFERENCES public.roast_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL DEFAULT 20 CHECK (max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at timestamptz,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cupping_invites_roast_session_id_idx ON public.cupping_invites (roast_session_id);
CREATE INDEX cupping_invites_user_id_idx ON public.cupping_invites (user_id);
CREATE INDEX cupping_invites_token_idx ON public.cupping_invites (token);

CREATE TABLE public.cuppings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  roast_session_id uuid NOT NULL REFERENCES public.roast_sessions(id) ON DELETE CASCADE,
  roast_profile_id uuid REFERENCES public.roast_profiles(id) ON DELETE SET NULL,
  form_version text NOT NULL DEFAULT 'sca_v1',
  cupped_at timestamptz NOT NULL DEFAULT now(),
  cupped_by text,
  scores jsonb NOT NULL,
  total_score numeric(6,2) NOT NULL,
  defects integer NOT NULL DEFAULT 0 CHECK (defects >= 0),
  notes text,
  descriptors text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'web'
    CHECK (source IN ('desktop', 'web', 'invite')),
  invite_id uuid REFERENCES public.cupping_invites(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cuppings_user_id_idx ON public.cuppings (user_id);
CREATE INDEX cuppings_roast_session_id_idx ON public.cuppings (roast_session_id);
CREATE INDEX cuppings_roast_profile_id_idx ON public.cuppings (roast_profile_id);

ALTER TABLE public.cuppings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupping_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cuppings"
  ON public.cuppings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cuppings"
  ON public.cuppings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cuppings"
  ON public.cuppings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own cuppings"
  ON public.cuppings FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own cupping invites"
  ON public.cupping_invites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cupping invites"
  ON public.cupping_invites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cupping invites"
  ON public.cupping_invites FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own cupping invites"
  ON public.cupping_invites FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cuppings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupping_invites TO authenticated;
GRANT ALL ON public.cuppings TO service_role;
GRANT ALL ON public.cupping_invites TO service_role;
