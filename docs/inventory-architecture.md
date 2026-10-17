# Inventory Architecture — 3-ledger event sourcing

> Last verified: 2026-07-21  
> Status: green / bulk roasted / finished-goods ledgers in production. Workspace RLS + idempotency hardening applied (`20260721000000_inventory_ledger_fixes.sql`, `20260728010000_inventory_flow_hardening.sql`).

**Audience:** coding agents. Do not invent stock columns or ad-hoc multi-ledger writes.

---

## 1. Overview — three ledgers

All stock is the **SUM of append-only events**. There are no denormalized quantity columns (`beans.stock_grams` and `bean_inventory_logs` were removed in `20260619000001`).

| Ledger | Unit | Target | event_type |
|---|---|---|---|
| `bean_stock_events` | g (green) | bean | `purchase` + / `roast` − / `adjustment` ± / `write_off` − |
| `roasted_stock_events` | g (bulk roasted) | bean **or** blend (`single_source` CHECK: exactly one) | `roast_inbound` + / `packaging` − / `blend_consume` − / `blend_produce` + / `adjustment` ± / `write_off` − |
| `product_stock_events` | bags (units) | product | `roast_inbound` + / `order_fulfillment` − / `order_cancel` + / `adjustment` ± / `write_off` − |

- `roasted_stock_events.is_estimate`: when output weight is not measured, roast-level estimates inbound grams. Measured weight later **replaces** the same session row via `upsert_roasted_inbound` (the only intentional exception to pure append-only).
- Happy path: green `purchase` → roast green `roast` − + bulk `roast_inbound` + → packaging bulk − + product `roast_inbound` + → order `order_fulfillment` −.
- Green pipeline `expected_inbound` was removed (`20260731000000`); physical inbound is `purchase` only (create + restock). `current` and `available` are the same event sum; `effective = available − reserved`.

**Name collision:** `roast_inbound` means bulk roast output on `roasted_stock_events`, and packaging inbound on `product_stock_events`. Same name, different meaning.

---

## 2. Write paths

### bean_stock_events (green)

| Action | Code | Event |
|---|---|---|
| Bean create / restock | `src/widgets/add-bean-modal/ui/useAddBeanSubmit.ts` | `purchase` (`reference_id` null) |
| Roast save deduct | `src/views/active-roast/model/useRoastSaveFlow.ts` → `src/features/active-roast/model/useDeductRoastStock.ts` / server `save_roast_op` | `roast`, ref = session or batch id. Blends: `src/features/active-roast/lib/buildRoastStockEvents.ts` → `insert_stock_events_batch` RPC |
| Schedule batch complete | `complete_plan_batch` RPC via schedule writes (`plan-day-flow.ts`) | `roast`, ref = `plan_batch.id` (remaining sessions computed under batch lock). Legacy app versions still call `insert_stock_events_batch`; the server clamps batch-level `roast` events to `plan_batch_remaining_roast_grams` after locking the batch. |
| Manual adjust | `src/features/adjust-*` (product/roasted); bean adjust UI where present | `adjustment` / `write_off` |

### roasted_stock_events (bulk)

| Action | Code | Event |
|---|---|---|
| Roast save auto inbound | `src/features/active-roast/model/useSaveRoast.ts` + `lib/roastedInbound.ts` → `upsert_roasted_inbound` | `roast_inbound`, ref = session.id; estimate if unweighed |
| History output edit | `src/views/history/ui/OutputWeightEditor.tsx` → same RPC | estimate → measured upsert; server resolves bean/blend from session + plan batch |
| Packaging | `src/features/package-product/model/usePackageProduct.ts` → `insert_packaging_op` | bulk `packaging` − + product `roast_inbound` + **one TX** |
| Blending | `src/features/blend-roasted/model/useBlendRoasted.ts` → `insert_roasted_stock_events_batch` | `blend_consume` − (per component bean) + `blend_produce` +, shared op id |

### product_stock_events (finished goods)

| Action | Code | Event |
|---|---|---|
| Packaging inbound | `src/features/package-product` → `insert_packaging_op` | `roast_inbound` +, ref = packaging op uuid |
| Order fulfill | `fulfill_order(p_order_id)` via `src/entities/order/api.ts` → `src/features/fulfill-order` | `order_fulfillment` −, ref = `order_line.id` |
| Order cancel (restore) | `cancel_order(p_order_id)` via `src/entities/order/api.ts` → `src/features/cancel-order` | restores fulfilled lines (`order_cancel` +) |
| Channel cancel / inbound | `sync_channel_orders_batch` RPC | atomically writes cancel/restore paths when platform status changes |

**Never** insert multi-ledger ops with raw table inserts from the client. Use the RPCs above.

### Stock write lock order (`20261017160300_stock_concurrency_atomicity.sql`)

When one transaction touches multiple parents, acquire locks in this order only:

1. Advisory locks (channel order sync)
2. `recurrence_rules` (recurring plan batches)
3. `orders`
4. `order_lines` (implicit via fulfillment paths)
5. `roast_plan_batches`
6. `roast_day_plans` (`FOR SHARE` for owner checks)
7. `products`
8. `beans`
9. `blends`

Row locks use `FOR NO KEY UPDATE` on products, beans, blends, and plan batches where possible so `KEY SHARE` FK readers (e.g. `order_lines` inserts) are not blocked.

**Exceptions (still compatible):** `#875` channel sync paths may lock `products` with `FOR UPDATE`. `save_roast_op` still locks `recurrence_rules` and `roast_plan_batches` with `FOR UPDATE` (rule-before-batch order matches `lock_roast_plan_batch_for_write`). Legacy `insert_stock_events_batch` reads `roast_day_plans` with `FOR SHARE` for owner checks after the batch lock.

---

## 3. Idempotency (partial unique indexes)

Retries must not double-count. Pattern: partial unique + `ON CONFLICT DO NOTHING` (or upsert for roast inbound).

| Ledger | Index | Migration |
|---|---|---|
| bean | `(reference_id, bean_id) WHERE reference_id IS NOT NULL` | `20260619000000` |
| roasted | `(reference_id) WHERE roast_inbound` (one inbound per session; upsert target) | `20260720000000` |
| roasted | packaging / blend_produce / blend_consume partial uniques | `20260721000000` |
| product | `(reference_id, product_id, event_type) WHERE reference_id IS NOT NULL` | `20260717000000` |

Manual `purchase` / adjust with `reference_id` null has **no** DB idempotency — client submit guards only.

---

## 4. RLS

All three ledgers use `has_workspace_access(user_id)` so team members read/write the **owner** workspace stock.

- bean/product: `supabase/migrations/20260718045740_workspace_security.sql`
- roasted: moved to workspace access in ledger-fix migrations
- Stock RPCs are `SECURITY INVOKER` — RLS still applies to the caller

Writes must use **workspace owner id** (`useActiveWorkspace().workspaceOwnerId`), not bare `auth.user.id`, when building `user_id` / query keys. See `docs/agent/workspace-auth.md`.

---

## 5. F3 double-deduct guard

Schedule "complete batch" deducts green with `reference_id = plan_batch.id`. A later linked roast save would deduct again with `reference_id = session.id`.

- Client: `useRoastSaveFlow` checks `beanStockEventApi.hasRoastDeductionForReference(planBatchId)` and skips UX deduct when present (fail-open if the check itself fails).
- Server: `save_roast_op` / batch paths also skip or raise `roast_already_deducted` (C2) so status can still complete.

**Invariant:** one green roast deduction per logical batch/session claim — never both refs for the same physical green.

---

## 6. Read paths

| Ledger | Aggregation | Consumers |
|---|---|---|
| bean | `getStockSummariesByUser` → `{ currentGrams, reservedGrams, effectiveGrams }`. Reserved = remaining planned sessions × batch size | Bean list/detail, dashboard, add-batch modal |
| roasted | `get_user_roasted_stock` → keys `bean:<id>` \| `blend:<id>` | Bulk UI, package/blend modals |
| product | `get_user_product_stock` → units by product | Products / orders |

Helpers: `ensureRoastedStock` / `ensureProductStock` (cache-first). Invalidation roots: `src/shared/lib/query-keys.ts` → `inventoryQueryRoots`.

---

## 7. Known limits

| # | Limit |
|---|---|
| 1 | Manual purchase/adjust with null `reference_id` is not DB-idempotent |
| 2 | `roast_inbound` name collision across ledgers |
| 3 | No lot-level traceability — sums only at bean/blend/product |
| 4 | Inventory alerts that key only on auth user miss foreign workspace hosts |

---

## 8. File index

| Layer | Path | Role |
|---|---|---|
| entities | `src/entities/bean-stock-event/api.ts` | bean ledger + `hasRoastDeductionForReference` |
| entities | `src/entities/roasted-stock-event/api.ts` | upsert inbound / batch insert / stock RPC wrap |
| entities | `src/entities/product-stock-event/api.ts` | packaging op / stock RPC wrap |
| features | `src/features/active-roast/model/useDeductRoastStock.ts`, `useSaveRoast.ts`, `lib/roastedInbound.ts` | green deduct / bulk inbound |
| features | `src/features/package-product/`, `src/features/blend-roasted/` | packaging / blend builders |
| features | `src/features/fulfill-order/`, `src/features/cancel-order/` | product stock via order RPCs |
| views | `src/views/active-roast/model/useRoastSaveFlow.ts` | save orchestration + F3 guard |
| views | `src/views/schedule/hooks/useScheduleDayView.ts` | batch complete deduct |
| views | `src/views/history/ui/OutputWeightEditor.tsx` | output weight → inbound upsert |
| DB | migrations under `supabase/migrations/*stock*`, `*inventory*` | schema + RPCs |

Related agent docs: `docs/agent/active-roast-save.md`, `docs/agent/schedule-plan.md`, `docs/agent/sales-channels-orders.md`.
