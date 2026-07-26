-- Issue #129 — sales_channel_connections had full DML grant to `authenticated`.
-- Combined with the workspace policy (FOR ALL USING has_workspace_access(user_id))
-- any workspace member could write EF-owned columns directly:
--   poll_cursor          → rewind / skip the inbound order window
--   shop_identifier      → repoint webhook routing at another tenant's shop
--   status               → re-enable a disabled connection
--   consecutive_failures → mask sync failures
--   webhook_registered / last_error / last_polled_at → falsify sync state
--
-- Legitimate client writes (verified against src/, no RPC touches this table):
--   read   → salesChannelApi.list                (SELECT)          src/entities/sales-channel/api.ts:29
--   toggle → salesChannelApi.setAutoFulfill      (UPDATE 2 cols)   src/entities/sales-channel/api.ts:84
--   delete → channel-disconnect EF runs on the ANON key + user JWT, so the
--            DELETE grant + RLS policy must stay  supabase/functions/channel-disconnect/index.ts:26
--   insert → none (channel-connect / cafe24-oauth-callback use service role)
--
-- Everything else goes through service-role Edge Functions, which bypass both
-- RLS and column grants — no EF path is affected by this migration.

REVOKE INSERT, UPDATE ON public.sales_channel_connections FROM authenticated;

-- Only the auto-fulfill toggle stays client-writable (+ updated_at it stamps).
GRANT UPDATE (auto_fulfill_on_shipped, updated_at)
  ON public.sales_channel_connections
  TO authenticated;

-- SELECT/DELETE are unchanged and re-granted here so the end state is explicit
-- regardless of which migrations a given environment has applied.
GRANT SELECT, DELETE ON public.sales_channel_connections TO authenticated;
