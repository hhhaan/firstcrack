-- Phase 2: sales channel connections + secrets + order sync runs
-- Credentials never leave service-role Edge Functions.

-- ── sales_channel_connections (client-readable metadata) ────────────────────

CREATE TABLE sales_channel_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform              text NOT NULL CHECK (platform IN ('naver', 'cafe24', 'shopify')),
  shop_identifier       text NOT NULL,
  display_name          text,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'error', 'disabled')),
  last_error            text,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  poll_cursor           jsonb,
  last_polled_at        timestamptz,
  webhook_registered    boolean NOT NULL DEFAULT false,
  auto_fulfill_on_shipped boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_platform_shop UNIQUE (user_id, platform, shop_identifier)
);

CREATE INDEX sales_channel_connections_user_idx
  ON sales_channel_connections(user_id);

CREATE INDEX sales_channel_connections_active_poll_idx
  ON sales_channel_connections(status)
  WHERE status = 'active';

ALTER TABLE sales_channel_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own channel connections" ON sales_channel_connections
  FOR ALL USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_channel_connections TO authenticated;

-- ── sales_channel_secrets (service-role ONLY) ───────────────────────────────
-- No policies, no grants to authenticated/anon. Same trust model as polar-webhook.

CREATE TABLE sales_channel_secrets (
  connection_id uuid PRIMARY KEY REFERENCES sales_channel_connections(id) ON DELETE CASCADE,
  credentials   jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_channel_secrets ENABLE ROW LEVEL SECURITY;
-- intentional: zero policies → only service_role bypasses RLS

-- ── orders.connection_id FK (was placeholder in Phase 1) ────────────────────

ALTER TABLE orders
  ADD CONSTRAINT orders_connection_id_fkey
  FOREIGN KEY (connection_id)
  REFERENCES sales_channel_connections(id)
  ON DELETE SET NULL;

-- ── order_sync_runs (system log) ────────────────────────────────────────────

CREATE TABLE order_sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   uuid REFERENCES sales_channel_connections(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger         text NOT NULL DEFAULT 'cron'
                    CHECK (trigger IN ('cron', 'manual', 'webhook')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'error', 'skipped')),
  orders_upserted integer NOT NULL DEFAULT 0,
  error_message   text
);

ALTER TABLE order_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own sync runs" ON order_sync_runs
  FOR SELECT USING (auth.uid() = user_id);

GRANT SELECT ON order_sync_runs TO authenticated;

-- ── Notes for deploy ────────────────────────────────────────────────────────
-- Cron (optional, requires pg_net + vault secrets on project):
--   every 15 min POST to {SUPABASE_URL}/functions/v1/order-sync
--   header: x-cron-secret: {ORDER_SYNC_CRON_SECRET}
-- body: {}  (empty → sync all active connections)
-- Set env ORDER_SYNC_CRON_SECRET on the order-sync Edge Function.
