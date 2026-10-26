# Supabase — agent handbook

**Audience:** coding agents  
**Date:** 2026-10-02  
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
| `firstcrack-mcp` | independent opaque MCP bearer; disabled by default, `verify_jwt=false` | Read-only selected-workspace tools. Issuer migration waits for Deploy migrations. Flags stay off until Edge secrets are set | `functions/firstcrack-mcp/`, `_shared/mcp-oauth/`, `../docs/agent/firstcrack-mcp.md` |
| `firstcrack-oauth` | public S256 PKCE endpoints; internal consent/grant routes verify native first-party JWT; disabled by default, `verify_jwt=false` | Independent opaque access/rotating refresh tokens, private grants and user revocation; never exports native tokens | `functions/firstcrack-oauth/`, `_shared/mcp-oauth/` |
| `channel-connect` | user JWT | Validate Naver/Shopify creds; store connection + secrets (service role) | `functions/channel-connect/` |
| `channel-disconnect` | user JWT | Delete connection (orders kept) | `functions/channel-disconnect/` |
| `channel-products` | user JWT | List a connection's platform catalog for SKU mapping (#131); secrets stay server-side, Naver returns `[]` | `functions/channel-products/` |
| `cafe24-oauth-start` | user JWT | Signed OAuth state → authorize URL | `functions/cafe24-oauth-start/` |
| `cafe24-oauth-callback` | public redirect | Code exchange → connection + secrets | `functions/cafe24-oauth-callback/` |
| `order-sync` | user JWT **or** `x-cron-secret` (`verify_jwt = false`) | Pull/upsert orders; token refresh | `functions/order-sync/`, `_shared/channels/*` |
| `order-webhook` | platform signature (**`verify_jwt = false` — deploy `--no-verify-jwt`**) | Push ingest; topic-routed, idempotent per `X-Shopify-Webhook-Id` | `functions/order-webhook/`, `_shared/webhook-auth.ts`, `_shared/channels/shopify-webhook.ts` |
| `order-dispatch` | user JWT (+ workspace/org rules) | Mark shipped on platform; `order_dispatches`; takes the `order_sync_runs` run lock (`trigger='dispatch'`) | `functions/order-dispatch/`, `_shared/channels/run-lock.ts` |
| `create-polar-checkout` | user JWT | Polar checkout URL | `functions/create-polar-checkout/` |
| `polar-webhook` | Polar HMAC | **Only** path that mutates `subscriptions` / plan fields | `functions/polar-webhook/` |
| `notify-signup` | DB webhook secret | Slack new-user | `functions/notify-signup/`, `_shared/slack.ts` |
| `polar-webhook` | Polar HMAC | Subscription + **Slack payment notify** + Sentry on error | `functions/polar-webhook/`, `_shared/slack.ts`, `_shared/sentry.ts` |

Secrets: `SLACK_WEBHOOK_URL` (signup + payment + errors), optional `SENTRY_DSN` for Edge.
| `coffee-futures` | public | Yahoo `KC=F` proxy (short cache) | `functions/coffee-futures/` |
| `get-cupping-session` | invite token | Public cupping payload | `functions/get-cupping-session/` |
| `submit-cupping` | invite/owner | Claim seat / batch publish / legacy sample upsert | `functions/submit-cupping/` |
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
| `profiles.simulator_enabled` | service role only (client write frozen with billing columns) |
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

## Local apply (before commit)

Docker is for this check only. App dev stays on the hosted project (`VITE_SUPABASE_URL`). CI does not run this reset.

A new or edited file under `supabase/migrations/` is applied on the local Supabase stack before commit:

1. Docker is running.
2. From the repo root: `supabase start`. `config.toml`: API `54321`, Postgres `54322`, `major_version = 15`.
3. `supabase db reset --local` replays every file in `supabase/migrations/` onto an empty local database.
4. Done when that command exits 0. Then `supabase stop` unless another local check follows in the same session.

Exit 0 means the chain applies in order (syntax, functions, grants). The local database has no production rows, Auth users, R2, or Polar.

Production apply stays on the release path: `release.yml` → `deploy-migrations.yml` `supabase db push`. Pending files on `main` sit until the next `pnpm release`. Hotfix without a desktop build: Actions → Deploy migrations → `confirm=deploy`. A laptop does not `db push` or `db reset --linked`.

After the local reset succeeds, schema migrations update `src/shared/types/database.types.ts` in the same commit. `pnpm types:gen` reads the **linked** project, so it sees a migration only after that project has it. Until then, generate from the local stack and keep the alias append:

```bash
supabase gen types typescript --local > src/shared/types/database.types.ts
node scripts/append-db-aliases.mjs
```

Pre-commit blocks a staged migration without that types file. RLS/GRANT-only migrations use `SKIP_TYPES_GEN=1` and still require the local reset.

CI gate (supabase-ci `rls-check`): a **new** migration with `CREATE TABLE` must contain `GRANT ... TO authenticated` in the same file, or opt out with a `-- skip-grant-check: <reason>` comment (service_role-only tables like `sales_channel_secrets`).

---

## Agent invariants

1. Never put service role, R2, channel, or Polar secrets in the Vite client.
2. Prefer `SECURITY INVOKER` RPCs so RLS still applies (existing stock RPCs follow this).
3. New Edge Function: put shared crypto/auth in `_shared/`; document auth mode in this table.
4. Deploy: `supabase functions deploy <name>` after reviewing JWT verify settings for that function.
   Functions without a block default to `verify_jwt = true` (e.g. `channel-products`).
   `order-webhook` and `order-sync` use `verify_jwt = false`: deploy both with
   `--no-verify-jwt`. The webhook verifies the platform signature/secret; sync verifies
   `x-cron-secret` or calls `getAuthenticatedUser` for a manual user JWT. The pg_cron
   request sends only `x-cron-secret`, without an Authorization header. A valid cron
   secret authorizes a sweep across all active connections, without a user filter.
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
