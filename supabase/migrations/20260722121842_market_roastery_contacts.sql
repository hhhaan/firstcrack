-- Ops: track whether we contacted a market-directory roastery
CREATE TABLE public.market_roastery_contacts (
  roastery_id text PRIMARY KEY,
  contacted boolean NOT NULL DEFAULT true,
  contacted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.market_roastery_contacts IS
  'Admin ops: contact outreach flag for market-roasteries directory IDs';

CREATE INDEX market_roastery_contacts_contacted_idx
  ON public.market_roastery_contacts (contacted)
  WHERE contacted = true;

ALTER TABLE public.market_roastery_contacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.market_roastery_contacts FROM PUBLIC;
REVOKE ALL ON TABLE public.market_roastery_contacts FROM anon, authenticated;
GRANT ALL ON TABLE public.market_roastery_contacts TO service_role;
