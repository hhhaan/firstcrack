# Roast save Slack notifications

Every newly completed roast sends a message through the existing server-only
`SLACK_WEBHOOK_URL`. There is no daily limit, first-use filter or client telemetry.
Existing desktop versions also work because the database observes the save.

`on_roast_completed_slack` runs after a completed `roast_sessions` insert or a
status transition to `completed`. Retrying the idempotent `save_roast_op`, saving
an incomplete record and editing an already completed record do not enqueue a
message. Imported completed records and simulator saves are included.

The trigger queues only the session UUID through `pg_net`, which sends after the
transaction commits. `notify-roast` verifies its shared secret and reads the
committed record so the final server-assigned batch title is available. Its Slack
message includes the owner's roastery/display name, the `created_by` operator's
display name, batch title, bean label, charge weight, roast time in KST and record
UUID. Missing names fall back to UUIDs; missing operator identity stays unknown.
User-provided names are rendered as Slack `plain_text`, so they cannot mention a
channel or inject Slack links. Billing data, addresses and curve data are excluded.

## One-time activation

Do these on the intended Supabase project when deployment is authorized. No
production deployment or test Slack message is part of local verification.

1. Generate one random shared secret (at least 32 random bytes). Store it in the
   project's Edge Function secrets as `NOTIFY_ROAST_SECRET`. Keep the existing
   server-only `SLACK_WEBHOOK_URL`; never create a `VITE_` variant.
2. In that project's SQL editor, store the same secret and the function URL in
   Vault. Replace the placeholders; never commit the resulting SQL with values.

   ```sql
   select vault.create_secret('<same random secret>', 'notify_roast_secret');
   select vault.create_secret(
     'https://<project-ref>.supabase.co/functions/v1/notify-roast',
     'notify_roast_url'
   );
   ```

   On rotation, use `vault.update_secret` on the existing named row instead of
   creating another name. Update `NOTIFY_ROAST_SECRET` to the identical value.
3. Deploy `notify-roast` with `supabase/config.toml` (`verify_jwt = false` because
   authentication uses `x-webhook-secret`). Apply the pending migration through
   the normal release or approved migration workflow. The migration can precede
   Vault setup: absent configuration skips notifications without blocking saves.
4. Inspect the next authorized real save in Slack and Edge Function logs. Do not
   create a fake production roast just to test the notification.

## Delivery and verification

Notifications are best effort: missing secrets, queue errors, deleted records,
Edge outages or Slack outages never roll back a roast or its inventory changes.
There is no delivery retry worker or replay deduplication store. The normal
database save retry enqueues once; manually replaying a valid webhook sends again.
Inspect failed deliveries in `net._http_response` and the existing Edge Sentry
integration. Failed notifications are not replayed on later History edits.

Local checks:

```sh
pnpm exec vitest run supabase/functions/notify-roast/index.test.ts
deno check --node-modules-dir=none supabase/functions/notify-roast/index.ts
psql "$LOCAL_DATABASE_URL" -U supabase_admin -v ON_ERROR_STOP=1 -f supabase/tests/notify_roast.sql
```

The SQL check runs as the local `supabase_admin` role, which owns `auth.users`,
against the locally migrated Supabase schema and rolls back all fixtures and
queued HTTP requests. It checks save/retry/edit behavior,
completion transitions, transaction rollback, secret handling, execution grants
and save success when enqueueing is unavailable. This trigger-only migration
changes no Data API table or RPC types; trigger functions are excluded by the
Supabase type generator.

2026-11-07 verification: local `supabase db reset --local` and the SQL checks
passed against an isolated snapshot of the deployed pre-change schema on
Postgres 17. This verifies the new migration against that snapshot, rather than
replaying the incomplete historical chain; see the baseline limitation in
`docs/agent/active-roast-save.md`. Generated public Data API types were
byte-identical before and after the migration; `notify_roast_slack` was excluded
as a trigger function. No generated-type edit is needed.
