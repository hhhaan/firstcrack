# Offline POS Open API — multi-region integration catalog (KR / JP / US)

**Audience:** coding agents, product  
**Date:** 2026-07-22  
**Status:** research + roadmap (no connector code required by this doc)  
**Related:**  
- Pipeline: `docs/agent/sales-channels-orders.md`  
- KR detail: `docs/agent/toss-place-integration.md`  
- Backlog: `TODOS.md` [ORD3]  
- Pricing IDs: `docs/pricing/07-integrations-catalog.md`, country flags `docs/pricing/09-country-feature-flags.md`

---

## 1. Goal

Pull **offline POS sales** (completed tickets / orders + line items + payments) into First Crack’s order SSoT (`orders` / `order_lines`) so roasteries can run ERP-style revenue + finished-goods stock across markets.

| In scope | Out of scope (v1 per connector) |
|----------|----------------------------------|
| Server↔server **Open API / Admin API** with public (or partner-accessible) docs | Front / terminal plugin UI SDKs only |
| Order/transaction list by time + cancel/refund path | Tax filing, e-invoice, accounting export (store raw amounts only) |
| SKU map → `products.sku` | Writing menu/stock **into** the POS (unless trivial later) |
| Adapter under `_shared/channels` + EF connect/sync/webhook | Device drivers, card terminal SDKs |

**Architecture (all regions):** same as marketplaces — desktop never holds platform secrets; EF adapter → `upsertCanonicalOrders`; stock only via `fulfill_order` / `cancel_order`; POS is **pull-only** (`outboundDispatch: false`) unless the platform is also an online marketplace (Shopify).

---

## 2. Shared design rules

| Rule | Detail |
|------|--------|
| Platform ID | snake_case enum: `toss_place`, `smaregi`, `square`, `shopify` (existing), … |
| Secrets | `sales_channel_secrets` +/or function env — **never** `VITE_*` |
| Canonical unit | Closed sale → `CanonicalStatus` **`paid`**; cancel/refund → `cancelled` / `refunded` |
| Adapter shape | `ChannelAdapter` + `capabilities: { webhooks, outboundDispatch, channelKind }` — POS = `channelKind: 'pos'`, `outboundDispatch: false` |
| Client dual SSoT | `src/shared/lib/channel-registry.ts` must mirror each adapter row (insights use kind, not platform string) |
| Sales insights | `computeSalesFacts(orders, period)` over `orders`/`order_lines` only — no POS SDK |
| Primary pull | Time-window list (order/transaction) + pagination + rate-limit backoff |
| Optional push | Webhooks when signature is documented (HMAC / OAuth app secret) |
| Tax | Keep `tax` / `taxAmount` / VAT fields in `orders.raw` (and optional later columns); no tax product in v1 |
| Multi-store | One connection per store/location/merchant id (`shop_identifier`) |
| Catalog SKU | Prefer merchant-defined product code / SKU / barcode → `products.sku` |

---

## 3. Priority matrix (Open API fitness × roastery relevance)

| Priority | Platform ID | Regions | Open API quality | Why |
|----------|-------------|---------|------------------|-----|
| **P0** | `shopify` | US, JP, KR, global | High (Admin GraphQL + webhooks) | **Already shipped.** Shopify POS sales = normal Orders. |
| **P0** | `toss_place` | KR | High (documented Open API) | KR offline POS / ERP path. Plan: `toss-place-integration.md`. |
| **P1** | `smaregi` | JP | High (Platform API) | Top JP cloud POS with public developer API + webhooks. |
| **P1** | `square` | US, JP (+ more) | High (Orders/Payments APIs) | Ubiquitous café/retail POS; POS orders queryable via Orders API. |
| **P2** | `clover` | US | Medium–High (REST + OAuth app) | US SMB retail/F&B; partner app model. |
| **P2** | `lightspeed` | US, JP (partial) | Medium (Retail / Restaurant APIs) | Higher-end retail; product-line split. |
| **P3** | `toast` | US | Medium (partner) | Restaurant-heavy; API often partner-gated. |
| **Defer** | AirREGI, Ubiregi (new), USEN/POS+/STORES alone | JP | Weak / partner-only / API sunset | Not first Open API targets. |
| **Defer** | Toshiba Tec / NEC / Fujitsu terminals | JP enterprise | SI contracts | Not SMB roastery self-serve. |

---

## 4. Korea (KR)

### 4.1 Market shape

- Offline café/roastery POS increasingly **토스플레이스 토스 POS** (+ legacy/local POS).
- Online already covered: Naver, Cafe24, Shopify.

### 4.2 Open API target: **Toss Place** (`toss_place`)

| Item | Value |
|------|--------|
| Docs | https://docs.tossplace.com/reference/open-api/intro.html |
| Auth | App key pair headers `x-access-key` / `x-secret-key` (not OAuth) |
| Tenant | App install per merchant; path `{merchantId}` |
| Sales unit | Order (`COMPLETED` / `CANCELLED` list default) |
| List | `GET .../merchants/{merchantId}/order/orders?from&to&orderStates=` |
| Payments | Embedded + `GET .../payment/payments/by-order-id` |
| Webhooks | `order.order.completed.v1`, `payment.payment.approved.v1`, HMAC `x-toss-signature` `v1=` |
| Rate limit | Token bucket ~**100 burst / 10 rps** per merchant |
| SKU | `OrderLineItem.item.code` / catalog `code` |
| Tax raw | `chargePrice` / payment `taxAmount`, `supplyAmount`, `taxExemptAmount`, line `isTaxFree` |
| FC plan | **`docs/agent/toss-place-integration.md`** |
| Catalog naming | Prefer `toss_place` (Commerce/POS). Do **not** use pricing id `toss` as “Toss Payments”. |

### 4.3 Not primary

- Toss Payments PG alone (no offline menu ERP).
- Front plugin-only payments (FAQ: not auto-mapped to Open API orders).

---

## 5. Japan (JP)

### 5.1 Market shape (SMB tablet/cloud)

Common names (not formal market-share audit):

| Tier | Products | Notes for FC |
|------|----------|--------------|
| High account volume | **AirREGI** (Recruit) | Free-tier heavy; **not** best self-serve Open API for custom ERP |
| Feature / multi-store | **スマレジ (Smaregi)** | Strong API story; ERP/accounting integrations common |
| iPad POS | **ユビレジ (Ubiregi)** | API **docs public end / new-dev discouraged** (vendor notice ~2025–2026) |
| Global | **Square** | Growing JP presence; same global APIs |
| Bundle / partner | USENレジ, POS+, STORESレジ | Often preset accounting links; weak public OpenAPI |
| Enterprise hardware | 東芝テック / NEC / 富士通 | SI only |

### 5.2 Open API target A: **スマレジ** (`smaregi`) — **JP P1**

| Item | Value |
|------|--------|
| Product | https://smaregi.jp/product/api.php |
| Developers | https://smaregi.jp/developers/ |
| API reference | https://developers.smaregi.dev/platform-api-reference/ |
| Preferred API | **Platform API** (OAuth 2.0). Legacy “スマレジAPI” → migrate away. |
| Endpoints (shape) | Sandbox `https://api.smaregi.dev/{contract_id}/pos` · Prod `https://api.smaregi.jp/{contract_id}/pos` |
| Auth | OAuth2 client credentials + authorization code (app on Smaregi Developers); scopes e.g. `pos.products:read`, transaction scopes per plan |
| Plan gate | API typically **Premium 以上** on merchant side |
| Data for ERP | Transactions (取引), products, (stock if scoped) — map closed 取引 → `CanonicalOrder` |
| Webhooks | Platform API webhook (event + id → re-fetch via GET; not full payload dump) |
| FC connect sketch | Developers app (FC) + merchant OAuth / contract_id; `shop_identifier` = `contract_id` (or store id if multi) |
| Capabilities | `webhooks: true`, `outboundDispatch: false` |
| Tax | JP 内税/外税 fields in transaction raw; no e-tax in v1 |

**Implement phases (when scheduled):**  
0 Partner/dev app + sandbox · 1 poll 取引 → normalize · 2 webhook · 3 catalog SKU map · 4 tax export later.

### 5.3 Open API target B: **Square** (`square`) — **JP + US shared**

See §6.2. Same connector, region flag `JP` + `US` (and others as product allows).

### 5.4 Explicit non-targets (JP Open API first wave)

| Product | Why defer |
|---------|-----------|
| AirREGI | Data link mostly via approved partner systems / データ連携API, not a general “build any ERP” public OpenAPI like Smaregi/Square |
| Ubiregi | Public API documentation ended for new development |
| USEN / POS+ / STORES alone | Prefer their freee-style partner links; negotiate only if enterprise customer demands |

### 5.5 Shopify POS in JP

Merchants on **Shopify + Shopify POS**: covered by existing `shopify` adapter (orders include POS). No separate platform id. Optionally later filter/display `source_name` / channel for analytics.

---

## 6. United States (US)

### 6.1 Market shape (café / specialty retail)

| Product | Typical segment | Open API for sales pull |
|---------|-----------------|-------------------------|
| **Square** | SMB café, market, cart | Excellent — Orders + Payments |
| **Shopify POS** | Omnichannel DTC + retail | Excellent — Admin Orders (existing FC) |
| **Clover** | SMB retail / some F&B | Good — REST + app marketplace |
| **Toast** | Full-service / restaurant | Partner-oriented; higher friction |
| **Lightspeed** | Retail / restaurant lines | Documented APIs; multi-product |
| **Revel / NCR / Aloha** etc. | Enterprise / franchise | Custom SI |

### 6.2 Open API target A: **Square** (`square`) — **US P1 (shared with JP)**

| Item | Value |
|------|--------|
| Docs | https://developer.squareup.com/ |
| Orders API | https://developer.squareup.com/docs/orders-api/what-it-does |
| Auth | OAuth (seller grants app) or access token; location-scoped |
| POS sales | Orders from Square POS queryable; `Order.source` may be `SQUARE_POS`; payments tagged with Square product |
| List/search | Orders search / list by location + time |
| Payments | Payments API; tax/tip on order/payment objects |
| Webhooks | payment/order events (official webhook subscriptions) |
| Catalog | Catalog API for SKU/variation ids → `products.sku` |
| FC connect sketch | OAuth app → store `merchant_id` + `location_id`(s); multi-location = multi connection or location list in secrets |
| Capabilities | `webhooks: true`, `outboundDispatch: false` (unless later shipping use cases) |
| Japan note | Square documents JP development: https://developer.squareup.com/docs/international-development/japan |

### 6.3 Open API target B: **Shopify POS** (`shopify`) — **already live**

| Item | Value |
|------|--------|
| Path | Existing `shopify` adapter + webhooks |
| POS | In-store sales create Admin **Order**s (same sync) |
| Gap | No explicit POS vs online badge in FC UI; optional `raw`/channel field later |
| Dispatch | Online fulfill remains; walk-in often auto-fulfilled on Shopify side — do not force FC dispatch |

### 6.4 Open API target C: **Clover** (`clover`) — **US P2**

| Item | Value |
|------|--------|
| Docs | Clover developer platform (REST, OAuth app, merchant tokens) |
| Sales | Orders / payments endpoints for closed tickets |
| Model | App installed on merchant Clover account; device-agnostic cloud data |
| When | After Square if US demand is Clover-heavy regions |

### 6.5 Open API target D: **Lightspeed** (`lightspeed_retail` / restaurant split) — **P2**

- Retail vs Restaurant are different API products — **do not** one id for both until scoped.
- Use only if customers require it; prefer Square/Shopify first.

### 6.6 Toast (`toast`) — **P3 / enterprise**

- Strong US restaurant POS share; integration often **partner program**.
- Treat as enterprise custom, not self-serve Pro+ v1.

---

## 7. FC implementation pattern (all POS connectors)

```
Platform POS (merchant)
  → channel-connect (OAuth or key validate)
  → sales_channel_connections + sales_channel_secrets
  → order-sync poll (cron/manual)  and/or  order-webhook
  → ChannelAdapter.fetchOrdersSince → CanonicalOrder
  → upsertCanonicalOrders → orders / order_lines
  → stock via fulfill_order / cancel_order only
```

| Touch point | Path |
|-------------|------|
| Types | `src/entities/sales-channel/api.ts` `ChannelPlatform` |
| Adapter | `supabase/functions/_shared/channels/<platform>.ts` + `types.ts` `Platform` |
| Registry | `adapters.ts` |
| Status map | `status-map.ts` |
| EF | `channel-connect`, `order-sync`, `order-webhook` |
| Migrations | `orders.platform` + `sales_channel_connections.platform` CHECK |
| UI | connect modal + orders list (hide dispatch for POS-only) |
| Pricing | `07-integrations-catalog.md` + `09-country-feature-flags.md` |
| Flag | `integration.<catalog_id>` e.g. `integration.toss_place`, `integration.smaregi`, `integration.square` |

### Suggested status map (POS closed sale)

| Platform concept | Canonical |
|------------------|-----------|
| Completed / closed / paid ticket | `paid` |
| Void / cancel | `cancelled` |
| Refund (full) | `refunded` |
| Open tab / in progress | skip or `pending` (default: do not poll open) |

### Tax (all regions)

- v1: raw only (`orders.raw` JSON).  
- Later: optional columns + reports; region-specific (KR 부가세, JP 消費税, US sales tax) as separate phase.

---

## 8. Recommended build order

| Phase | Platform | Region flags | Depends |
|-------|----------|--------------|---------|
| Done | `shopify` (incl. POS orders) | US, JP, KR | — |
| Next | `toss_place` | KR | ORD3, partner app |
| Next | `square` | US, JP | OAuth app, multi-location |
| Next | `smaregi` | JP | Developers app, Premium merchants |
| Later | `clover` | US | demand |
| Later | Lightspeed / Toast | US | demand / partner |

Do **not** start Ubiregi or AirREGI as custom Open API projects without a renewed public API commitment.

---

## 9. Pricing catalog recommendations

When promoting from research → `planned`:

| ID | Name | Region | Category | Notes |
|----|------|--------|----------|-------|
| `toss_place` | Toss Place POS | KR | Commerce/POS | Replace mislabelled `toss` Payments row |
| `smaregi` | スマレジ | JP | Commerce/POS | Platform API, Premium+ |
| `square` | Square POS | US, JP | Commerce/POS | Orders API; not “Stripe store” only |
| `shopify` | Shopify (+ POS) | Global | Commerce | Already beta — note offline POS included |

Future candidates table can drop vague “POS | All | Open” once the above are listed.

Country flags examples:

- `KR`: `integration.toss_place`  
- `JP`: `integration.smaregi`, `integration.square`, `integration.shopify`  
- `US`: `integration.square`, `integration.shopify` (± clover later)

---

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Confusing PG vs POS (Toss Payments, Square payments-only) | Catalog names + docs stress **POS sales/orders** |
| Merchant plan gates (Smaregi Premium, Shopify scopes) | Connect UX shows plan requirements |
| Multi-location (Square) | Connection per location or explicit location multi-select |
| API sunset (Ubiregi) | Avoid new build |
| Partner-only APIs (Toast, some JP bundles) | Enterprise queue only |
| Rate limits / poll cost | Cursor + webhook prefer; respect platform limits |
| Tax law differences | Raw store first; no filing claims |

---

## 11. Doc index (starting points)

### KR
- Toss Place Open API: https://docs.tossplace.com/reference/open-api/intro.html  
- FC plan: `docs/agent/toss-place-integration.md`

### JP
- Smaregi API product: https://smaregi.jp/product/api.php  
- Smaregi Developers: https://smaregi.jp/developers/  
- Platform API reference: https://developers.smaregi.dev/platform-api-reference/  
- Square JP: https://developer.squareup.com/docs/international-development/japan  

### US / global
- Square Orders: https://developer.squareup.com/docs/orders-api/what-it-does  
- Shopify Admin / POS orders: existing FC Shopify adapter + Shopify Admin API  
- Clover: Clover developer docs (partner app)  
- Lightspeed: Lightspeed developer docs (Retail vs Restaurant)

### FC internal
- `docs/agent/sales-channels-orders.md`  
- `supabase/functions/_shared/channels/*`  
- `docs/pricing/07-integrations-catalog.md`

---

## 12. One-line summary

| Region | First POS Open API bets |
|--------|-------------------------|
| **KR** | **Toss Place** (`toss_place`) |
| **JP** | **スマレジ** (`smaregi`) + **Square** (+ Shopify POS if already on Shopify) |
| **US** | **Square** + **Shopify POS** (live); Clover later |

All map into the same `orders` / `order_lines` ERP spine; tax later; secrets server-side only.
