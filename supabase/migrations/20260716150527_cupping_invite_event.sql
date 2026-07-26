-- Session (event) level QR: one invite per cupping event, not per sample

ALTER TABLE public.cupping_invites
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.cupping_events(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS cupping_invites_event_id_idx ON public.cupping_invites (event_id);

-- Backfill event_id from sample when possible
UPDATE public.cupping_invites i
SET event_id = s.event_id
FROM public.cupping_samples s
WHERE i.sample_id = s.id
  AND i.event_id IS NULL;
