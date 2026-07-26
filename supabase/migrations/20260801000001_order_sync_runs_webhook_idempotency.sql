-- Issue #127 — webhook deliveries had no idempotency store, so every platform
-- retry re-ran the full upsert (and, on a shipped transition, the auto-fulfill
-- stock deduction) as if it were a fresh event.
--
-- Shopify sends a stable X-Shopify-Webhook-Id per event; retries reuse it.
-- order-webhook inserts the run row *before* processing and treats a unique
-- violation as "already handled" (ack 200). On failure it nulls the key back
-- out so the platform retry is allowed through.
--
-- Reuses order_sync_runs instead of a new table: it already logs
-- trigger='webhook' runs and the daily retention cron
-- (run_daily_inventory_maintenance, 20260726000000_cost_hygiene.sql) ages
-- keys out after 90 days for free.

ALTER TABLE public.order_sync_runs
  ADD COLUMN IF NOT EXISTS external_event_id text;

-- Partial: cron/manual runs and platforms without an event id header stay NULL
-- and are never deduplicated.
CREATE UNIQUE INDEX IF NOT EXISTS order_sync_runs_external_event_idx
  ON public.order_sync_runs (connection_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- Written by service-role Edge Functions only. Column-level grants are
-- inherited from the existing table-level GRANT SELECT TO authenticated
-- (20260717014911_sales_channels.sql) — no new grant needed, and none is added
-- so the client stays read-only on this table.
