-- Public post-session results link (token is unguessable; not a global feed)

ALTER TABLE public.cupping_events
  ADD COLUMN IF NOT EXISTS results_token text;

CREATE UNIQUE INDEX IF NOT EXISTS cupping_events_results_token_uidx
  ON public.cupping_events (results_token)
  WHERE results_token IS NOT NULL;

COMMENT ON COLUMN public.cupping_events.results_token IS
  'Unguessable token for public results page (/r/:token). Set when session ends.';
