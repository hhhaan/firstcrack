# Toss Place Open API — offline sales / ERP integration plan

**Audience:** coding agents  
**Date:** 2026-07-22  
**Status:** Phase 1 pull-only connector implemented (#84). Phase 0 partner keys still required for live data. Phase 2 webhooks not shipped.  
**Related:** `docs/agent/sales-channels-orders.md`, `docs/agent/pos-openapi-integrations.md` (KR/JP/US POS catalog), `TODOS.md` [ORD3], `docs/pricing/07-integrations-catalog.md`  
**External SSoT:** [Open API 소개](https://docs.tossplace.com/reference/open-api/intro.html) · [공통 가이드](https://docs.tossplace.com/reference/open-api/common.html) · [개발 튜토리얼](https://docs.tossplace.com/guide/pos-integration/open-api/develop-tutorial.html) · [연동 이해하기](https://docs.tossplace.com/guide/understanding.html)

---

## 1. Goal

Offline roastery POS sales (토스플레이스 토스 POS) land in First Crack’s order SSoT so ERP-style revenue, product mix, and finished-goods stock flow work the same way as marketplace channels.

| In scope (v1) | Deferred |
|---------------|----------|
| Pull POS/KIOSK orders + payments into `orders` / `order_lines` | Tax reporting, 부가세 신고, 세금계산서, 회계 export |
| Connect per merchant via Open API key pair | Front 플러그인 SDK / Windows DLL / POS Plugin UI |
| Poll + optional webhooks | POS product write / inventory qty push into Toss |
| SKU map via catalog / line `code` → `products.sku` | Approved-only order-create / payment-record write APIs |
| Stock via existing `fulfill_order` / `cancel_order` | `order-dispatch` outbound ship (N/A for walk-in POS) |

**Product choice:** use **POS Open API** (server↔server). Docs classify it as “주문 연동, 매출 연동, **ERP 시스템 연동**” — not Front-plugin payments and not Toss Payments PG.

---

## 2. Naming: Toss Place ≠ Toss Payments

| ID | Meaning | Action |
|----|---------|--------|
| **`toss_place`** (recommended platform enum) | Toss Place POS Open API — offline order/sales | Use for `ChannelPlatform`, DB CHECKs, catalog |
| `toss` in `docs/pricing/07-integrations-catalog.md` today | Mislabelled as “Toss Payments 등” / Payments | Correct to `toss_place`, category **Commerce/POS**, notes “Open API order+payment pull” when implementing ORD3 |

Do **not** implement Toss Payments (PG/checkout) under this connector.

Feature flag: keep KR gate; rename `integration.toss` → `integration.toss_place` when catalog is fixed (or alias both during migration).

---

## 3. Auth & tenancy

### 3.1 Partner app (once per FC product)

1. Register at [developers.tossplace.com](https://developers.tossplace.com) (per develop tutorial).
2. Create application type **API**.
3. Issue key pair: **Access Key** + **Secret Key** (secret shown once).
4. Optional: register **webhook** endpoint + webhook signing secret in developer console (one URL for all merchants that install the app).
5. Live publish after 검수 (~1 day average per understanding guide).

FC operates **one Open API app**; many roastery merchants install it.

### 3.2 Per-merchant install

- Open API only works for merchants that **installed** the app.
- Path parameter everywhere: `{merchantId}` (Long).
- Webhooks for all installed merchants hit the same Payload URL; body includes `merchantId` for routing.
- Events: `app.installation.created.v1` / `app.installation.deleted.v1` — use to discover / revoke access.

### 3.3 HTTP auth (not OAuth)

```http
GET https://open-api.tossplace.com/api-public/openapi/v1/merchants/{merchantId}
x-access-key: <API Access Key>
x-secret-key: <API Secret Key>
Content-Type: application/json
```

- Envelope: `{ "resultType": "SUCCESS", "success": <payload> }` or `FAIL` + `error.errorCode`.
- Timestamps: ISO 8601 strings.
- Pagination: `page` (1-based), `size` (1–500, default 100), `sortOrder` ASC|DESC.

### 3.4 Where credentials live in FC

| Secret | Storage | Never |
|--------|---------|--------|
| Platform app `x-access-key` / `x-secret-key` | Prefer **function env** `TOSS_PLACE_ACCESS_KEY` / `TOSS_PLACE_SECRET_KEY` (one app for all tenants) **or** per-connection `sales_channel_secrets` if multi-app later | Client / `VITE_*` |
| Webhook signing secret | Function env `TOSS_PLACE_WEBHOOK_SECRET` | Client |
| Merchant link | `sales_channel_connections.shop_identifier` = string `merchantId`; `display_name` from Merchant API | — |

**Connect UX (v1):** workspace owner pastes **merchantId** (from POS/partner install). EF `channel-connect` calls `GET .../merchants/{merchantId}` with app keys; on SUCCESS store connection `platform='toss_place'`, status `active`. Do **not** ask the user for access/secret if FC owns the partner app.

**Ownership verification (required):** app keys are FC-global, so `GET /merchants/{id}` succeeds for **any** merchant that installed the app — pasting someone else's merchantId (Long, enumerable) must not grant access to their sales. `channel-connect` must bind installation → workspace, not just check the GET succeeds:

1. Persist `app.installation.created.v1` events (merchantId + installedAt) into a claimable table/log.
2. On connect, require the merchantId to be an **unclaimed** installation; reject if already linked to another workspace (unique on `merchantId` across workspaces, not just `(user_id, platform, shop_identifier)`).
3. Show merchant `display_name` from the Merchant API and require explicit user confirmation ("이 매장이 맞습니까?") before activating.
4. If webhook-based install discovery isn't live yet (Phase 1 before webhooks), interim proof: match a recent order timestamp or amount the owner reads off their POS screen — do not skip verification.

**Multi-store:** one workspace may have N connections (unique `(user_id, platform, shop_identifier)`). Each store = one `merchantId`.

Aligns with invariants in `docs/agent/sales-channels-orders.md` and `supabase/AGENTS.md`.

---

## 4. Rate limits

Token bucket **per merchant** ([common guide](https://docs.tossplace.com/reference/open-api/common.html)):

| Rule | Value |
|------|--------|
| Burst | 100 tokens |
| Refill | 10 tokens / second |
| On exceed | HTTP **429** |
| Headers | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` (epoch ms) |
| Trace | `x-toss-event-id` on every response (log for support) |

Adapter must backoff on 429 using `x-ratelimit-reset`. Sequential per-connection poll is fine; do not fan out unbounded detail calls without pacing.

---

## 5. Primary data model for offline revenue

### 5.1 Unit of ERP truth = **Order**

Docs: Order is the unit that tracks line items, charges, discounts, and payments. Payment always belongs to an order.

| Toss concept | Field highlights | FC mapping |
|--------------|------------------|------------|
| Order | `id`, `merchantId`, `source` (`POS`, `KIOSK`, …), `orderState`, `orderKey`, `orderNumber`, `createdAt`, `completedAt`, `cancelledAt` | `orders.platform_order_id` = `id`; `ordered_at` = `createdAt` or `completedAt` for completed sales; `raw` = full Order JSON |
| OrderLineItem | `item.title`, **`item.code`**, `quantity`, `itemPrice.priceValue`, `itemPrice.isTaxFree` | `order_lines`; SKU key = `item.code` (see §7) |
| OrderChargePrice | `totalAmount`, `taxAmount`, `supplyAmount`, `taxExemptAmount`, discounts, tip, service charge | `orders.total_amount` ← `chargePrice.totalAmount` (Long, unit = 원; KRW has no sub-unit — store as numeric, no /100) |
| Payment[] | Embedded on Order; also queryable by order | Keep inside `orders.raw`; optional later table |
| Discount[] | title, amount, code | raw only in v1 |

### 5.2 Order states → canonical status

| Toss `orderState` | Meaning | FC `CanonicalStatus` (v1) |
|-------------------|---------|---------------------------|
| `REQUESTED` | Awaiting accept (pickup etc.) | `pending` (optional poll; default list excludes) |
| `OPENED` | In progress / post-pay open ticket depending on flow | skip or `preparing` — **default list excludes** |
| **`COMPLETED`** | Payment finished | **`paid`** (offline sale closed; not marketplace ship) |
| **`CANCELLED`** | Declined / refunded incomplete | **`cancelled`** (or `refunded` if payments all CANCELLED — prefer cancelled + raw) |
| `UNDEFINED` | ignore | — |

List API defaults: `orderStates=["COMPLETED","CANCELLED"]` — exactly what ERP bulk sales needs.

### 5.3 Payment (revenue detail, tax raw)

| Endpoint | Use |
|----------|-----|
| Embedded `Order.payments` | Prefer when list/detail returns full order |
| `GET .../payment/payments/by-order-id?orderId=` | Fill gaps / webhooks that only carry payment |
| `GET .../payment/payments/{paymentId}` | Single lookup |
| ~~Global payment list by time~~ | **Not documented** — bulk revenue = **order list `from`/`to`**, not payment time scan |

Payment fields to **retain in raw** for later tax (do not build tax engine in v1):

- `amount`, `taxAmount`, `supplyAmount`, `taxExemptAmount`, `tipAmount`
- `state`: `APPROVED` | `CANCELLED`
- `sourceType`: `CASH` | `CARD` | `PREPAID_VALUE` | `ACCOUNT_TRANSFER` | `BARCODE` | `EXTERNAL` | …
- `approvedNo`, `approvedAt`, `cancelledAt`, card/cash/easyPay details, `cashReceipt`, `settlement`

Line-level tax hints: `itemPrice.isTaxFree`, `taxPercentage`, `taxInclusive` — also raw only.

### 5.4 Endpoints used by the adapter

Base: `https://open-api.tossplace.com/api-public/openapi/v1/merchants/{merchantId}`

| Purpose | Method | Path |
|---------|--------|------|
| Test connect / merchant meta | GET | `/` (merchant) |
| **Order list (primary pull)** | GET | `/order/orders?from=&to=&orderStates=&page=&size=&sortOrder=` |
| Order detail | GET | `/order/orders/{orderId}` |
| Orders by ids (≤25) | GET | `/order/orders/by-ids?ids=` |
| Payments for order | GET | `/payment/payments/by-order-id?orderId=` |
| Catalog items (SKU map assist) | GET | `/catalog/items?page=&size=` |
| Catalog search | GET | `/catalog/items/search?...` |

**Write APIs (document only — not v1):** order create, order state change, payment record/cancel require **approved apps**; FAQ says ERP product write is not generally available; no real-time stock qty API.

---

## 6. Inbound sync design (ERP path)

```
Toss POS (merchant installed FC app)
  → [poll] order-sync EF → tossPlaceAdapter.fetchOrdersSince
  → normalize → upsert orders / order_lines
  → [optional] order-webhook (HMAC) → same normalize

Desktop app: orderApi.list only (no Toss SDK in src/)
Stock: fulfill_order / cancel_order RPCs only (not product_stock_events inserts)
Outbound order-dispatch: not used for POS walk-in
```

### 6.1 Poll (`order-sync`)

1. Read connection + secrets (merchantId + app keys from env or secrets).
2. Window: `from` = `poll_cursor.since` (default now−7d first run); `to` = now.
3. `GET .../order/orders` with `orderStates=COMPLETED,CANCELLED`, page until empty / max pages.
4. Map each Order → `CanonicalOrder` (see §8).
5. If `payments` empty but needed, optional `by-order-id` (rate-limit aware).
6. `upsertCanonicalOrders` (existing `normalize.ts`).
7. Advance `poll_cursor.since` to last successful window end (overlap 1–2 min to avoid clock skew).

**Late-cancellation rescan (required while poll-only):** if `from`/`to` filters on order creation time, a COMPLETED order refunded days later falls outside the advancing window and its CANCELLED transition is silently missed — retail refunds routinely happen days after sale. Until Phase 2 webhooks are live, each poll must also re-fetch a trailing window (e.g. last 7d, `orderStates=CANCELLED` only) or use an updated-at filter if the API supports one (verify against OAS). The 1–2 min overlap covers clock skew only, not refunds.

Respect 100 burst / 10 rps per merchant; page size ≤100 default OK, max 500.

### 6.2 Webhooks (phase 1.5 / 2)

Developer console registers **one** URL for the app:

`https://<PROJECT_REF>.supabase.co/functions/v1/order-webhook?platform=toss_place`

| Header | Role |
|--------|------|
| `x-toss-signature` | `v1=` + hex(HMAC-SHA256(webhookSecret, `${timestamp}.${rawBody}`)) |
| `x-toss-timestamp` | reject if skew large |
| `x-toss-webhook-id` | idempotency key (store/dedupe) |
| `x-toss-event-id` / `x-toss-delivery-id` | logging |

At-least-once delivery; fail closed on bad signature (401/400).

**Subscribe at minimum:**

| Event | Action |
|-------|--------|
| `order.order.completed.v1` | Fetch full order if payload thin → upsert as `paid` |
| `order.order.cancelled.v1` | Upsert `cancelled`; stock compensate if fulfilled |
| `payment.payment.approved.v1` | Optional: attach payment into raw / trigger order re-fetch by `orderId` |
| `payment.payment.cancelled.v1` | Optional re-fetch order |
| `app.installation.created.v1` | Ops signal / future auto-provision |
| `app.installation.deleted.v1` | Mark connection `disabled` |

**Gateway note:** today `order-webhook` may still have `verify_jwt` true (see `docs/db-cost-audit.md`) — must be `false` when enabling external POSTs; HMAC is the real auth.

### 6.3 POS vs marketplace behavior

| | Marketplace (Naver/Shopify/Cafe24) | Toss Place POS |
|--|-----------------------------------|----------------|
| Primary status after sale | paid → preparing → shipped | **paid** (COMPLETED) |
| Dispatch | yes | **no** (`capabilities.outboundDispatch: false`) |
| Webhooks | shop-specific secrets | app-level secret + `merchantId` |
| Fulfill | pack/ship finished goods | optional: auto-fulfill on COMPLETED if product mapped (setting); default **manual fulfill** or workspace policy for café vs bag sales |

Roasting requirements RPC already keys off `paid`/`preparing` + unfulfilled lines — POS bag sales with SKU mapping fit without new RPC.

---

## 7. Catalog & SKU mapping

| Toss field | Role |
|------------|------|
| `OrderLineItem.item.code` | Primary SKU candidate on sold lines |
| `CatalogItem.code` | Menu product code (POS 상품관리 / excel) |
| `CatalogItem.barcode` | Secondary; map only if FC stores barcode as sku (usually don’t) |

**Rule (v1):** extend product map so keys include line `item.code` and catalog `code` matched to `products.sku` (same pattern as platform product/variant id in `normalize.ts` `buildProductMap`).

Ops: before go-live, register codes in Toss POS (excel bulk) so `code` is non-empty — FAQ warns empty codes if registration path wrong.

Catalog APIs are **read-only** for general apps; no ERP→POS product push; **no stock quantity API** — stock SSoT remains FC `products` + stock events via fulfill/cancel.

---

## 8. Canonical mapping sketch

```ts
// status
COMPLETED → 'paid'
CANCELLED → 'cancelled'
// optional later: OPENED → 'preparing', REQUESTED → 'pending'

// order
platformOrderId = order.id
orderedAt = order.completedAt ?? order.createdAt
buyerName = null // walk-in; optional memo later
currency = 'KRW'
totalAmount = order.chargePrice.totalAmount
lines[] = lineItems mapped by index/id
raw = full Order including payments, discounts, chargePrice, tax fields

// line
platformLineId = stable id if present else `${order.id}:${index}`
platformProductId = item.code || null  // SKU key for products.sku map
platformVariantId = null
title = item.title
quantity = quantity
unitPrice = itemPrice.priceValue
status = order CANCELLED → 'cancelled' else 'active'
```

**Tax deferral (explicit):** do not add tax report tables or VAT workflows in v1. Persist tax in `orders.raw` (and later optional columns `tax_amount`, `supply_amount`, `tax_exempt_amount` if reporting needs SQL without jsonb). No e-tax invoice, no 국세청 export, no accounting journal export.

---

## 9. Phased implementation (against current architecture)

Touch points (absolute):

| Area | Paths |
|------|--------|
| Agent docs | `docs/agent/sales-channels-orders.md`, this file |
| Pricing | `docs/pricing/07-integrations-catalog.md`, `docs/pricing/09-country-feature-flags.md` |
| Client types | `src/entities/sales-channel/api.ts` (`ChannelPlatform`) |
| UI connect | `src/widgets/connect-channel-modal/`, `src/views/orders/` |
| EF shared | `supabase/functions/_shared/channels/{types,adapters,status-map,normalize}.ts` + new `toss-place.ts` |
| EF entry | `supabase/functions/channel-connect/`, `order-sync/`, `order-webhook/` |
| Migrations | `orders.platform` CHECK, `sales_channel_connections.platform` CHECK → add `toss_place` |
| Secrets env | Supabase function secrets: `TOSS_PLACE_ACCESS_KEY`, `TOSS_PLACE_SECRET_KEY`, `TOSS_PLACE_WEBHOOK_SECRET` |

### Phase 0 — Partner ops (blocking live data)

- [ ] developers.tossplace.com API app + keys  
- [ ] Test merchant create/install app (tutorial steps 1–5)  
- [ ] Smoke: `GET /merchants/{id}` with curl  
- [ ] Live 검수 when ready for production merchants  

### Phase 1 — Pull-only connector (MVP ERP)

1. Migration: `toss_place` on platform CHECKs (`orders`, `sales_channel_connections`).
2. `Platform` / `ChannelPlatform` union + `tossPlaceAdapter`:
   - `capabilities: { webhooks: true, outboundDispatch: false }`
   - `testConnection` → Merchant GET
   - `refreshAuth` → `null` (static keys)
   - `fetchOrdersSince` → order list `from`/`to` + COMPLETED/CANCELLED
   - `listProducts` → catalog items → `{ sku: code, title, platformProductId: id }`
   - `markShipped` → `{ ok: false, error: 'not supported' }`
3. `channel-connect`: accept `platform: 'toss_place'`, credentials `{ merchant_id }`, keys from env.
4. `order-sync`: register adapter (no other special case).
5. Status map helpers + unit tests (COMPLETED/CANCELLED only).
6. UI: connect form field merchantId; hide dispatch for this platform.
7. Update `docs/agent/sales-channels-orders.md` table + pricing catalog ID `toss_place`.

**Success:** COMPLETED POS orders appear in `orders`/`order_lines`; mapped SKUs resolve `product_id`; fulfill deducts stock via existing RPC.

### Phase 2 — Webhooks + reliability

1. `order-webhook?platform=toss_place`: signature verify, merchantId → connection lookup, event switch, upsert.
2. Dedupe table or reuse `x-toss-webhook-id` storage if needed.
3. `verify_jwt=false` for webhook function only when shipping push.
4. Installation deleted → connection disabled.

### Phase 3 — ERP polish (still pre-tax)

1. Sales dashboard aggregates from `orders` where `platform = 'toss_place'` (and marketplaces).
2. Optional columns for tax amounts (still no filing).
3. Payment-method breakdown from `raw.payments[].sourceType`.
4. Optional auto-fulfill on COMPLETED for bag/retail SKUs.

### Phase 4 — Tax / accounting (later goal)

- VAT reports from stored `taxAmount` / `supplyAmount` / `taxExemptAmount`
- Cash receipt / 세금계산서 integrations as separate projects
- Export to external accounting ERP

---

## 10. Non-goals (v1)

1. Tax reporting, 부가세 신고, e-tax invoice, accounting export.  
2. Front 플러그인 SDK, Windows DLL, POS Plugin UI.  
3. Writing products/categories/inventory **into** Toss POS.  
4. Real-time POS stock quantity API (not provided).  
5. Order-create / payment-record write APIs (approval-gated; not required for pull ERP).  
6. Assuming kiosk/Front-plugin-only payments appear as Open API orders — FAQ: **not auto-mapped**. Offline completeness requires sales through **토스 POS orders**.  
7. Conflating with Toss Payments PG.  
8. Client-held secrets or `VITE_*` keys.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Pricing catalog says “Toss Payments” | Rename to `toss_place` / Commerce at implement time |
| No global payment time-range API | Use order list `from`/`to` as revenue spine |
| Empty `item.code` | Ops checklist + catalog list to validate codes |
| Rate limit 10 rps | Page size + backoff; no parallel stampede per merchant |
| Webhook JWT gateway | Flip verify_jwt only with HMAC ready |
| Kiosk/Front not in Open API orders | Document store must use POS order flow for ERP |
| Partner 검수 delay | Phase 0 parallel with Phase 1 against test merchant |
| Multi-tenant app keys | Env app keys + per-connection merchantId (default) |
| **merchantId hijack** — any workspace can paste another installed merchant's id and pull their sales | Ownership verification in §3.4: installation-event claim + cross-workspace unique merchantId + user confirmation |
| **Late refunds missed** — creation-time poll window skips CANCELLED transitions on old orders | Trailing CANCELLED rescan (§6.1) until webhooks live |

---

## 12. Alignment with [ORD3]

`TODOS.md` [ORD3] steps map as:

1. Spec/auth survey → **this document** (API key pair, not OAuth).  
2. `ChannelPlatform` + connections → `toss_place`.  
3. `channel-connect` validate/store → merchantId + env keys.  
4. `order-sync` normalize upsert → Phase 1.  
5. Outbound dispatch → **pull-only**; document N/A.  
6. Refresh `docs/sales-channel-integration.md` + pricing catalog on implement.

---

## 13. Verification checklist (when implementing)

- [ ] `GET merchant` succeeds with stored merchantId  
- [ ] Connect rejects a merchantId already claimed by another workspace; requires user confirmation of store name  
- [ ] Order CANCELLED days after COMPLETED is picked up by trailing rescan (poll-only mode)  
- [ ] Poll inserts COMPLETED order with lines and `raw.chargePrice` tax fields present  
- [ ] CANCELLED updates status without double stock deduct  
- [ ] SKU `products.sku` = line `item.code` → `product_id` set  
- [ ] Webhook bad signature rejected; good `order.order.completed.v1` upserts  
- [ ] No `order-dispatch` path required for platform  
- [ ] `pnpm verify:all` green; secrets absent from client bundle  

---

## 14. Doc index (researched)

| Doc | URL |
|-----|-----|
| Intro | https://docs.tossplace.com/reference/open-api/intro.html |
| Common (auth, pagination, rate limit) | https://docs.tossplace.com/reference/open-api/common.html |
| FAQ | https://docs.tossplace.com/reference/open-api/faq.html |
| Webhook | https://docs.tossplace.com/reference/open-api/webhook.html |
| App install events | https://docs.tossplace.com/reference/open-api/app.html |
| Merchant | https://docs.tossplace.com/reference/open-api/merchant.html |
| Order overview | https://docs.tossplace.com/reference/open-api/order.html |
| Order model | https://docs.tossplace.com/reference/open-api/order/order-model.html |
| Order list/get | https://docs.tossplace.com/reference/open-api/order/order-methods.html |
| Order webhooks | https://docs.tossplace.com/reference/open-api/order/order-events.html |
| Order create (approved) | https://docs.tossplace.com/reference/open-api/order/order-create.html |
| Payment | https://docs.tossplace.com/reference/open-api/payment.html |
| Catalog | https://docs.tossplace.com/reference/open-api/catalog.html |
| Develop tutorial | https://docs.tossplace.com/guide/pos-integration/open-api/develop-tutorial.html |
| Understanding (ERP) | https://docs.tossplace.com/guide/understanding.html |
| OAS | https://open-api.tossplace.com/swagger/v2/api-docs/v1 |
