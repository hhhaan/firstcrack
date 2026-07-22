-- Toss Place §3.4 ownership: claimable installations + webhook delivery dedupe.
-- Service-role only (no authenticated grants) — same trust model as sales_channel_secrets.

-- ── Claimable merchant installs (from app.installation.created.v1) ──────────
CREATE TABLE IF NOT EXISTS public.toss_place_installations (
  merchant_id text PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT now(),
  uninstalled_at timestamptz,
  claimed_connection_id uuid REFERENCES public.sales_channel_connections (id) ON DELETE SET NULL,
  claimed_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  claimed_at timestamptz,
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS toss_place_installations_claimed_user_idx
  ON public.toss_place_installations (claimed_user_id)
  WHERE claimed_user_id IS NOT NULL;

ALTER TABLE public.toss_place_installations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.toss_place_installations FROM anon, authenticated;
GRANT ALL ON TABLE public.toss_place_installations TO service_role;

-- ── Webhook delivery idempotency (x-toss-webhook-id) ────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_webhook_deliveries (
  platform text NOT NULL,
  delivery_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, delivery_id)
);

CREATE INDEX IF NOT EXISTS channel_webhook_deliveries_received_at_idx
  ON public.channel_webhook_deliveries (received_at);

ALTER TABLE public.channel_webhook_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.channel_webhook_deliveries FROM anon, authenticated;
GRANT ALL ON TABLE public.channel_webhook_deliveries TO service_role;
