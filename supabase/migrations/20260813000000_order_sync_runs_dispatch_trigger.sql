-- Issue #142 item 2 — order-dispatch joins the order-sync run lock.
-- The partial unique index (status='running' AND trigger <> 'webhook') already
-- covers any non-webhook trigger; this only widens the CHECK so a
-- trigger='dispatch' insert is legal. No types:gen change (trigger is text).

ALTER TABLE public.order_sync_runs
  DROP CONSTRAINT IF EXISTS order_sync_runs_trigger_check;

ALTER TABLE public.order_sync_runs
  ADD CONSTRAINT order_sync_runs_trigger_check
  CHECK (trigger IN ('cron', 'manual', 'webhook', 'dispatch'));
