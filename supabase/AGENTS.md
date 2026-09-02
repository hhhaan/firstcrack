# Supabase — agent handbook

**Audience:** coding agents  
**Date:** 2026-07-21  
**Root rules:** project `AGENTS.md` (secrets, `pnpm types:gen`, no `VITE_*` secrets)

---

## Purpose

Schema lives in `supabase/migrations/`. Privileged network and secret handling live in `supabase/functions/`. The desktop client uses the anon key + user JWT only.

---

## Edge function catalog

| Function | Auth | Role | Key files |
|----------|------|------|-----------|
| `get-upload-url` | user JWT | R2 PUT presign (`profile`/`bbp`); owner or `has_workspace_access` | `functions/get-upload-url/index.ts`, `_shared/r2.ts` |
| `get-download-url` | user JWT | R2 GET presign; key must match owned profile shape | `functions/get-download-url/index.ts` |
| `channel-connect` | user JWT | Validate Naver/Shopify creds; store connection + secrets (service role) | `functions/channel-connect/` |
| `channel-disconnect` | user JWT | Delete connection (orders kept) | `functions/channel-disconnect/` |
| `cafe24-oauth-start` | user JWT | Signed OAuth state → authorize URL | `functions/cafe24-oauth-start/` |
| `cafe24-oauth-callback` | public redirect | Code exchange → connection + secrets | `functions/cafe24-oauth-callback/` |
| `order-sync` | user JWT **or** `x-cron-secret` | Pull/upsert orders; token refresh | `functions/order-sync/`, `_shared/channels/*` |
| `order-webhook` | platform signature (**`verify_jwt = false` — deploy `--no-verify-jwt`**) | Push ingest; topic-routed, idempotent per `X-Shopify-Webhook-Id` | `functions/order-webhook/`, `_shared/webhook-auth.ts`, `_shared/channels/shopify-webhook.ts` |
| `order-dispatch` | user JWT (+ workspace/org rules) | Mark shipped on platform; `order_dispatches`; takes the `order_sync_runs` run lock (`trigger='dispatch'`) | `functions/order-dispatch/`, `_shared/channels/run-lock.ts` |
| `create-polar-checkout` | user JWT | Polar checkout URL | `functions/create-polar-checkout/` |
| `polar-webhook` | Polar HMAC | **Only** path that mutates `subscriptions` / plan fields | `functions/polar-webhook/` |
| `notify-signup` | DB webhook secret | Slack new-user | `functions/notify-signup/`, `_shared/slack.ts` |
| `polar-webhook` | Polar HMAC | Subscription + **Slack payment notify** + Sentry on error | `functions/polar-webhook/`, `_shared/slack.ts`, `_shared/sentry.ts` |

Secrets: `SLACK_WEBHOOK_URL` (signup + payment + errors), optional `SENTRY_DSN` for Edge.
| `coffee-futures` | public | Yahoo `KC=F` proxy (short cache) | `functions/coffee-futures/` |
| `get-cupping-session` | invite token | Public cupping payload | `functions/get-cupping-session/` |
| `submit-cupping` | invite/owner | Score upsert | `functions/submit-cupping/` |
| `get-cupping-results` | results/invite token | Aggregated results | `functions/get-cupping-results/` |

Shared modules: `functions/_shared/auth.ts`, `r2.ts`, `channels/*`, `webhook-auth.ts`, `cupping-score.ts`, `slack.ts`.

---

## Env secrets (names only — never commit values)

| Area | Env names (typical) |
|------|---------------------|
| R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` |
| Channels | `ORDER_SYNC_CRON_SECRET`, `CAFE24_CLIENT_ID`, `CAFE24_CLIENT_SECRET`, `CAFE24_REDIRECT_URI`, `CAFE24_OAUTH_STATE_SECRET`, Shopify/Cafe24 webhook secrets |
| Billing | `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` |
| Ops | `NOTIFY_SIGNUP_SECRET` |
| Platform | `SUPABASE_SERVICE_ROLE_KEY` (server only) |

Presign expiry: **300s** (`_shared/r2.ts`). Profile keys: `profiles/{uuid}/{uuid}(.bbp)?.tsv`.

---

## Write authority (do not invent)

| Data | Allowed writers |
|------|-----------------|
| R2 objects | Client PUT/GET only via presigned URLs from get-*-url EFs |
| `sales_channel_secrets` | Edge service role only (RLS on, no authenticated grant) |
| `subscriptions`, billing columns on `profiles` | `polar-webhook` (client write locked by migrations) |
| Multi-ledger stock | RPCs: `save_roast_op`, `insert_stock_events_batch`, `upsert_roasted_inbound`, `insert_packaging_op`, `insert_roasted_stock_events_batch`, `fulfill_order`, `cancel_order` |
| Channel orders upsert | `order-sync` / `order-webhook` adapters |
| Cupping public | Invite/results tokens via cupping EFs — do not open anon table RLS |

---

## Migration themes

Filenames under `supabase/migrations/` (group by prefix):

- **Inventory / stock:** `*stock*`, `*inventory*`, `*roasted_stock*`, `*products_and_stock*`
- **Orders / channels:** `*orders*`, `*sales_channel*`, `*order_dispatch*`
- **Workspaces / org:** `*workspace*`, `*org_*`
- **Plan / schedule:** `*plan*`, `*rrule*`, `*recurrence*`
- **Billing / gates:** `*polar*`, `*subscription*`, `*batch_gate*`, `*readonly*`, `*trial*`
- **Cupping:** `*cupping*`
- **RLS / grants:** `*rls*`, `*grant*`, `workspace_security`

After schema migrations: **`pnpm types:gen`** updates `src/shared/types/database.types.ts`. Pre-commit blocks migrations staged without types (bypass only for pure RLS/GRANT: `SKIP_TYPES_GEN=1`).

Prod apply is **automatic on desktop release** (`release.yml` → `deploy-migrations.yml` `supabase db push`). Pending files on `main` sit until the next `pnpm release`. Hotfix without a desktop build: Actions → Deploy migrations → `confirm=deploy`. Do not `db push` from a laptop against prod.

CI gate (supabase-ci `rls-check`): a **new** migration with `CREATE TABLE` must contain `GRANT ... TO authenticated` in the same file, or opt out with a `-- skip-grant-check: <reason>` comment (service_role-only tables like `sales_channel_secrets`).

---

## Agent invariants

1. Never put service role, R2, channel, or Polar secrets in the Vite client.
2. Prefer `SECURITY INVOKER` RPCs so RLS still applies (existing stock RPCs follow this).
3. New Edge Function: put shared crypto/auth in `_shared/`; document auth mode in this table.
4. Deploy: `supabase functions deploy <name>` after reviewing JWT verify settings for that function.
   Every function needs a `[functions.<name>]` block in `config.toml` — the default is
   `verify_jwt = true`, which silently 401s any platform-signed webhook at the gateway.
   `order-webhook` is the only channel function with `verify_jwt = false`; deploy it as
   `supabase functions deploy order-webhook --no-verify-jwt`. `order-sync` keeps
   `verify_jwt = true`, so a cron caller must send `Authorization: Bearer <ANON_KEY>`
   **and** `x-cron-secret`.
5. A service-role EF bypasses RLS, so it must resolve the **workspace owner** for any
   `user_id` it writes — RLS is `has_workspace_access(user_id)`, not `auth.uid() = user_id`.
   Use `resolveWorkspaceOwner` (`_shared/auth.ts`); it verifies a client-supplied owner id
   with the same predicate. Writing `auth.uid()` creates rows a member can never see.
6. Client-writable columns are a security boundary: `sales_channel_connections` grants
   `authenticated` only `SELECT`, `DELETE` and `UPDATE (auto_fulfill_on_shipped, updated_at)`
   (`20260801000000_*`). Never widen it back to a table-level UPDATE — EF-owned columns
   (`poll_cursor`, `shop_identifier`, `status`, …) must stay service-role only.
7. Do not "fix" stock by direct table edits in EF unless matching existing inbound-actions patterns and idempotency indexes.

Frontend domain guides: `docs/agent/*.md`, inventory SSoT `docs/inventory-architecture.md`.
