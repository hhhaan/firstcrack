-- Cupping session end: lock invites + sample edits when set

ALTER TABLE public.cupping_events
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

COMMENT ON COLUMN public.cupping_events.ended_at IS
  'When set, session is closed: no new samples/invites; public scoring rejected.';
