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
message separates the owner's roastery from the `created_by` operator. Operator
email comes only from the service-role Auth admin lookup for that exact user,
never from the webhook body or a client-supplied label. Missing names fall back
to the verified email or UUID; missing operator identity stays unknown.

Block Kit groups the final batch title and sequence numbers, bean/blend,
reference profile, snapshotted roaster, charge/output kilograms, measured loss,
roast duration, Charge/Drop BT, roast level and development/DTR. Optional groups
show whole/ground color, moisture, density, ambient temperature/humidity and
the saved roast note. KST roast time and latest save/edit time (`updated_at`)
appear with the record UUID in the footer. There is no raw curve or event dump.

Charge weight zero means the app's unset sentinel and displays as `미입력`;
quality/ambient zeros stay visible. Missing measured
output displays as `미측정`, without inventing an estimated weight or loss.
Duration follows History's valid Drop → End → stored-duration priority.
Development starts at `FC Start`, not `FC Rolling`, and is omitted when its
marks are missing or invalid.

Every user-provided value uses Slack `plain_text` with bounded lengths. The
useful notification fallback includes operator, batch and kilograms with
`&`, `<` and `>` escaped, preventing mentions and injected Slack links. Postal
addresses, billing data and machine connection details are excluded. Optional
profile, reference-profile or Auth lookup failures keep the roast notification
and fall back to available identity information rather than suppressing it.

## Example message

The Slack card uses a header, two-column field groups, dividers and a footer.
Example values below are illustrative:

**로스팅 저장**<br>
에티오피아 #1 · PR12

| | |
|---|---|
| **로스터리**<br>테스트 로스터리 | **작업자**<br>김로스터<br>roaster@example.invalid |
| **생두 / 블렌드**<br>에티오피아 구지 | **참조 프로파일**<br>구지 워시드 |
| **로스터**<br>Probat · P12 | **배치 번호 · 프로파일 / 전체**<br>1 / 12 |
| **투입 → 배출**<br>1.5 kg → 1.275 kg | **감량률**<br>15.0 % |
| **로스팅 시간**<br>10:00 | **투입 BT → 배출 BT**<br>180 °C → 205.5 °C |
| **로스팅 레벨**<br>Medium | **디벨롭 · DTR**<br>2:00 · 20.0 % |
| **색도 · 홀빈 / 분쇄**<br>65 / 72 | **수분율**<br>10.8 % |
| **밀도**<br>730 g/L | **환경 · 온도 / 습도**<br>22 °C / 40 % |

메모: 깔끔한 단맛

로스팅: 2026. 11. 7. 오전 12:30:00 KST<br>
최근 저장/수정: 2026. 11. 7. 오전 12:40:00 KST<br>
기록: `<session UUID>`

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
The optional Vault/`pg_net` block also catches `query_canceled` (including a
timeout during that work) and `assert_failure`, which PostgreSQL's `OTHERS`
handler excludes. This protection surrounds notification work only: core roast
validation and inventory failures still propagate and roll back the save.
There is no delivery retry worker or replay deduplication store. The normal
database save retry enqueues once; manually replaying a valid webhook sends again.
Inspect failed deliveries in `net._http_response` and the existing Edge Sentry
integration. Failed notifications are not replayed on later History edits.

Local checks:

```sh
pnpm exec vitest run supabase/functions/notify-roast/index.test.ts
deno check --node-modules-dir=none --no-lock supabase/functions/notify-roast/index.ts
psql "$LOCAL_DATABASE_URL" -U supabase_admin -v ON_ERROR_STOP=1 -f supabase/tests/notify_roast.sql
```

The SQL check runs as the local `supabase_admin` role, which owns `auth.users`,
against the locally migrated Supabase schema and rolls back all fixtures and
queued HTTP requests. It checks save/retry/edit behavior,
completion transitions, transaction rollback, secret handling, execution grants
and save success when enqueueing is unavailable. Fault injection inside
`net.http_post` checks ordinary errors, `query_canceled` and `assert_failure`
against the real authenticated `save_roast_op`: the roast, allocated title, green
deduction and measured roasted inbound survive each notification fault. A core
validation error still rolls back the roast and its queued notification.
This trigger-only migration
changes no Data API table or RPC types; trigger functions are excluded by the
Supabase type generator.

2026-11-07 verification: local `supabase db reset --local` and the SQL checks
passed against an isolated snapshot of the deployed pre-change schema on
Postgres 17. This verifies the new migration against that snapshot, rather than
replaying the incomplete historical chain; see the baseline limitation in
`docs/agent/active-roast-save.md`. Generated public Data API types were
byte-identical before and after the migration; `notify_roast_slack` was excluded
as a trigger function. No generated-type edit is needed.
