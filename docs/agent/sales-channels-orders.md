# Sales channels & orders (agent)

**Audience:** coding agents  
**Date:** 2026-07-21  
**Deeper Korean notes (local, often gitignored):** `docs/sales-channel-integration.md`, `docs/order-status-sync.md`, `docs/cafe24-oauth-setup.md`  
**Offline POS Open API (multi-region):** `docs/agent/pos-openapi-integrations.md` (KR/JP/US catalog).  
**Toss Place detail (KR):** `docs/agent/toss-place-integration.md` — `toss_place`, not Toss Payments.

---

## Purpose

Canonical order data lives in Supabase (`orders`, `order_lines`). The desktop app **never** talks to Naver / Shopify / Cafe24 APIs directly. Edge Functions own credentials, pull/push, and platform dispatch.

---

## Primary trees

| Layer | Paths |
|-------|--------|
| Entities | `src/entities/order/`, `src/entities/order-dispatch/`, `src/entities/sales-channel/`, `src/entities/product/` |
| Features | `src/features/fulfill-order/`, `src/features/cancel-order/`, `src/features/dispatch-order/` |
| UI | `src/views/orders/Orders.tsx`, `src/widgets/add-order-modal/`, `src/widgets/connect-channel-modal/` |
| Edge | `supabase/functions/channel-connect/`, `channel-disconnect/`, `cafe24-oauth-start/`, `cafe24-oauth-callback/`, `order-sync/`, `order-webhook/`, `order-dispatch/` |
| Shared EF | `supabase/functions/_shared/channels/*` (adapters, normalize, status-map, inbound-actions, dispatch) |

---

## Connect flows

```
User → connect channel
  Naver/Shopify → channel-connect EF (validate + store)
  Cafe24 → cafe24-oauth-start → browser consent → cafe24-oauth-callback
  → sales_channel_connections (client-readable metadata)
  → sales_channel_secrets (service-role only; no authenticated policies)
```

| Platform | Client input | Auth model | Outbound ship API |
|----------|--------------|------------|-------------------|
| Naver | Client ID + secret | client_credentials + signed requests | product-orders dispatch |
| Shopify | shop domain + Admin token | custom app token header | fulfillmentCreateV2 |
| Cafe24 | Mall ID only (OAuth) | Bearer + refresh via app env `CAFE24_CLIENT_*` | shipments |
| Toss Place (`toss_place`) | merchantId | Partner app `x-access-key`/`x-secret-key` in EF env (`TOSS_PLACE_*`) | **none** (pull-only POS) |

**Invariant:** Cafe24 must not accept pasted access tokens. Client must not store or re-display platform secrets.  
**Toss Place:** never paste Access/Secret keys in the desktop app; one merchantId may bind to only one workspace (unique claim).

---

## Inbound order sync

1. Manual "Sync now" (user JWT) or ~15m cron (`x-cron-secret` on `order-sync`)
2. Adapter pulls platform orders → normalize → upsert `orders` / `order_lines`
3. Webhooks: `order-webhook` (Shopify HMAC / Cafe24 shared secret) — fail closed on bad signature
4. App reads tables only via `orderApi.list(workspaceOwnerId)`

SKU mapping: when platform product/variant ids match `products.sku`, lines get `product_id` for stock + roasting requirements.

---

## Fulfill vs dispatch vs cancel

| Action | What it means | Writer | Stock |
|--------|---------------|--------|-------|
| **Fulfill** | Internal: goods left inventory; stamp `fulfilled_at` | RPC `fulfill_order` via `src/entities/order/api.ts` + `src/features/fulfill-order` | product `order_fulfillment` − per line |
| **Dispatch** | External: mark shipped on marketplace with carrier/tracking | EF `order-dispatch` via `src/features/dispatch-order` | no stock by itself |
| **Cancel** | Cancel order; restore stock if already fulfilled | RPC `cancel_order` | product restore via cancel path |

**Do not** equate `fulfilled_at` with platform "shipped".  
**Do not** flip `orders.status` with ad-hoc updates — inbound status merge is rank-based in `_shared/channels/status-map.ts` (cancelled/refunded are terminal).

`order_dispatches` lifecycle: pending → sent → confirmed (via poll/webhook).

Optional: inbound shipped + `auto_fulfill_on_shipped` can auto-run fulfill (default treat as opt-in; do not assume on).

---

## Manual orders

`orderApi.create` inserts order + lines; on line failure it best-effort deletes the orphan order (`src/entities/order/api.ts`). Still uses workspace `user_id` = owner.

Roasting needs: RPC `get_roasting_requirements` / `orderKeys.requirements(userId)`.

---

## Secrets & forbidden client paths

| Secret / table | Allowed writer |
|----------------|----------------|
| `sales_channel_secrets` | Edge Functions with service role only |
| `CAFE24_CLIENT_ID/SECRET`, `ORDER_SYNC_CRON_SECRET`, webhook secrets | Function env — never `VITE_*` |
| R2 | unrelated to channels; still EF-only (see `supabase/AGENTS.md`) |

Client may read `sales_channel_connections` metadata only.

---

## Agent invariants

1. App → Supabase tables / RPCs / order EFs only — no platform SDKs in `src/`.
2. Stock for orders only through `fulfill_order` / `cancel_order` (or documented inbound EF paths) — not raw `product_stock_events` inserts from UI.
3. Dispatch after (or independent of) fulfill is a product choice; do not merge the two code paths.
4. Invalidate `orderKeys.*` and product stock keys after fulfill/cancel (`query-keys.ts`).
5. New marketplace = new adapter under `_shared/channels` + connect/sync/dispatch paths — do not bolt secrets into the desktop bundle.
