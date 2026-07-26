-- Ops: hide/remove directory roasteries from admin list without rewriting JSON
CREATE TABLE public.market_roastery_hidden (
  roastery_id text PRIMARY KEY,
  hidden_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.market_roastery_hidden IS
  'Admin ops: soft-deleted market-roasteries directory IDs';

ALTER TABLE public.market_roastery_hidden ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.market_roastery_hidden FROM PUBLIC;
REVOKE ALL ON TABLE public.market_roastery_hidden FROM anon, authenticated;
GRANT ALL ON TABLE public.market_roastery_hidden TO service_role;
