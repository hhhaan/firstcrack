-- Custom cupping forms: workspace templates + per-event schema snapshot.
-- System presets (SCA v1, Simple 5) live in app code, not this table.

CREATE TABLE public.cupping_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  schema jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cupping_form_templates_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE INDEX cupping_form_templates_user_id_idx ON public.cupping_form_templates (user_id);

ALTER TABLE public.cupping_form_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace access cupping_form_templates"
  ON public.cupping_form_templates
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupping_form_templates TO authenticated;
GRANT ALL ON public.cupping_form_templates TO service_role;

ALTER TABLE public.cupping_events
  ADD COLUMN form_template_id uuid REFERENCES public.cupping_form_templates(id) ON DELETE SET NULL,
  ADD COLUMN form_snapshot jsonb;

UPDATE public.cupping_events
SET form_snapshot = '{
  "v": 1,
  "key": "sca_v1",
  "name": "SCA",
  "fields": [
    {"key": "fragrance", "label": "Fragrance", "min": 0, "max": 10, "step": 0.25},
    {"key": "aroma", "label": "Aroma", "min": 0, "max": 10, "step": 0.25},
    {"key": "flavor", "label": "Flavor", "min": 0, "max": 10, "step": 0.25},
    {"key": "aftertaste", "label": "Aftertaste", "min": 0, "max": 10, "step": 0.25},
    {"key": "acidity", "label": "Acidity", "min": 0, "max": 10, "step": 0.25},
    {"key": "body", "label": "Body", "min": 0, "max": 10, "step": 0.25},
    {"key": "balance", "label": "Balance", "min": 0, "max": 10, "step": 0.25},
    {"key": "overall", "label": "Overall", "min": 0, "max": 10, "step": 0.25}
  ],
  "scoring": {"base": 36, "defectWeight": 2}
}'::jsonb
WHERE form_snapshot IS NULL;

ALTER TABLE public.cupping_events
  ALTER COLUMN form_snapshot SET NOT NULL;

CREATE INDEX cupping_events_form_template_id_idx ON public.cupping_events (form_template_id);

COMMENT ON COLUMN public.cupping_events.form_snapshot IS
  'Schema copied at event create. Template edits do not mutate in-flight sessions.';
COMMENT ON COLUMN public.cupping_events.form_template_id IS
  'Provenance only. Scoring uses form_snapshot.';
