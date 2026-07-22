-- Billing market from Polar product (KR | US | JP).
-- SSOT: docs/pricing/04-geo-pricing.md

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country_code text;

COMMENT ON COLUMN public.profiles.country_code IS
  'Billing market from Polar product (KR|US|JP). Set by landing polar webhook.';