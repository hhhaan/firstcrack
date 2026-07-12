-- Track A3: persist roast event markers for history replay
ALTER TABLE public.roast_sessions
  ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.roast_sessions.events IS
  'Roast events [{id,type,time_sec,temp_c?,note?}] — charge-relative time_sec';
