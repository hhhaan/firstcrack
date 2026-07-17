# High-ROI Abstraction Opportunities

> Analysis date: 2026-07-17  
> Scope: design/UI, domain/logic, cross-cutting infra  
> Non-goal: implement refactors here — direction only

This doc ranks **concrete** consolidation opportunities by relative ROI (touch frequency × near-copy count × blast radius when a bug or design change hits). Paths are relative to repo root.

---

## ROI tiers

| Tier | Meaning |
|------|---------|
| **T1 — Do next** | Many near-copies or key-consistency bugs; small outcome-level fix pays immediately |
| **T2 — Do when touching** | Real duplication; extract on the next feature that edits the area |
| **T3 — Defer** | Valid smell but rare change rate, or extraction risk > gain |

Buckets: **(A) design/UI** · **(B) domain/logic** · **(C) cross-cutting infra**

---

## T1 — Highest ROI

### 1. Modal form chrome → finish `modalPanel` + form field tokens
**Bucket:** A · **Tier:** T1

**Problem**  
`modalPanel` exists but is only used by ~5 callers (`modalPanel.sm` / `settings`). Most create-modals still paste a near-identical ~200-char `contentClassName` (glass panel, blur, shadow, dark border). Form `inputCls` / `labelCls` / `tabCls` are copy-pasted with tiny pixel drift across widgets.

**Evidence**
- Shared tokens (partial): `src/shared/ui/modal-shell/modalPanel.ts`, `ModalShell.tsx`, `ModalHeader.tsx`, `ModalScrollBody.tsx`
- Inline panel string repeated in:  
  `src/widgets/add-bean-modal/ui/AddBeanModal.tsx`,  
  `add-product-modal`, `add-order-modal`, `add-blend-modal`, `add-batch-modal`, `add-machine-modal`,  
  `connect-channel-modal`, `src/features/dispatch-order/ui/DispatchModal.tsx`,  
  `src/views/profiles/NewProfileModal.tsx`
- Form style near-copies:  
  `src/widgets/add-bean-modal/lib/styles.ts`,  
  `src/widgets/add-batch-modal/lib/styles.ts`,  
  `src/widgets/cost-calculator/lib/format.ts` (`inputCls`/`labelCls`),  
  local consts in `DispatchModal.tsx`, `NewProfileModal.tsx`, `src/shared/ui/CounterInput.tsx`
- Confirm dialogs still diverge from `modalPanel.sm`:  
  `DeleteBeanModal.tsx`, `DeleteSessionModal.tsx`, `EndRoastModal.tsx`, `RoastSummaryModal.tsx`, `TodayScheduleModal.tsx`

**Proposed direction**  
1. Extend `modalPanel` with `formMd` / `formLg` (size only; keep shell chrome SSoT).  
2. Add `src/shared/ui/form-styles.ts` (or DESIGN-aligned utilities): single `inputCls`, `labelCls`, `tabCls`, `chipCls`.  
3. Migrate modals as they are touched — no big-bang redesign.

**ROI**  
~12+ modals; every dark-mode/border/shadow tweak currently multi-file. Highest visual consistency payoff per line deleted. Aligns with existing partial abstraction (`modalPanel` comment already says “callers pass size key”).

---

### 2. Centralize React Query key factories + kill raw string invalidation
**Bucket:** C · **Tier:** T1

**Problem**  
Each entity defines its own `*Keys` in `queries.ts` (good), but cross-slice invalidation often uses **raw string arrays** that can drift from factories. `src/shared/lib/query-keys.ts` only exports `dashboardKeys` — incomplete SSoT. Plan mutations mix `planKeys.*` with bare `['day_batches']`, `['recurrence_rules']`, etc.

**Evidence**
- Factories: `beanKeys`, `blendKeys`, `productKeys`, `planKeys`, `roastSessionKeys`, `stockEventKeys`, `cuppingKeys`, … under `src/entities/*/queries.ts`
- Partial shared: `src/shared/lib/query-keys.ts` (`dashboardKeys` only)
- Raw keys (examples):  
  - `src/entities/bean-stock-event/queries.ts` — `['bean-stock-summaries']`, `['inventory-alerts']`  
  - `src/entities/plan/queries.ts` — `invalidateScheduleQueries` uses `['day_batches']`, `['range_batches']`, `['day_plan_range']`, `['week_summary']`, `['month_summary']`; later blocks use `['plan_batches']`, `['recurrence_rules', userId]`, `['day_plan', userId]` mixed with `planKeys.*`  
  - `src/entities/roast-profile/queries.ts` — `['profile-bean-history', profileId]`, fallback `['roast_profile_curve', ...]`  
- Docs already warn: `docs/data-fetching.md` (“Cross-page invalidation” still unsettled)

**Proposed direction**  
1. Keep keys **owned by entity** (FSD: no entity→entity import for keys if avoidable).  
2. Re-export or document a single import map (`shared/lib/query-keys.ts` re-exports public key factories only where cross-slice invalidation needs them — or a thin `invalidateInventory(userId)` helper colocated in stock feature).  
3. Ban raw `queryKey: ['foo']` in mutations except temporary — use factory only.  
4. Align plan invalidation: every plan mutation goes through one `invalidatePlanScope(qc, …)` that uses `planKeys` only.

**ROI**  
`staleTime: Infinity` means a wrong key = silent stale UI. Plan/stock/roast paths touch dashboard, beans, alerts, schedule. Bug class is hard to spot in QA; one helper pays repeatedly.

---

### 3. LazyStore settings access → single store singleton + typed key helpers
**Bucket:** C · **Tier:** T1

**Problem**  
Five separate `new LazyStore('settings.json')` instances with copy-pasted localStorage fallback / debounce patterns. AGENTS.md already specifies: single settings.json, key=`domain.field`, singleton LazyStore, 200ms debounce.

**Evidence**
- `src/shared/lib/inventoryStore.ts`  
- `src/shared/lib/locationStore.ts`  
- `src/shared/lib/pricingStore.ts`  
- `src/shared/i18n/index.ts`  
- `src/features/active-roast/model/settings.ts` (has debounce; others often `save()` immediately)

**Proposed direction**  
One `shared/lib/settings-store.ts`: get/set/subscribe + optional debounce + localStorage fallback. Domain modules become thin key wrappers (`inventory.alertHorizonDays`, `pricing.fixedOverheads`, `roast.settings`, …).

**ROI**  
Reduces platform/web-dev inconsistency; matches documented architecture; every new setting currently re-implements the same 40-line try/catch.

---

## T2 — High ROI when next edited

### 4. Searchable combobox primitive (SearchableSelect ≈ BeanCombobox)
**Bucket:** A · **Tier:** T2

**Problem**  
Two hand-rolled searchable dropdowns with the same open/filter/outside-click structure; neither uses `shared/ui/select` (Radix Select — non-searchable).

**Evidence**
- `src/widgets/add-batch-modal/ui/SearchableSelect.tsx` (~120 lines)  
- `src/widgets/cost-calculator/ui/BeanCombobox.tsx` (~200 lines, adds free-text)  
- Radix: `src/shared/ui/select/Select.tsx` (different UX: closed list, no typeahead search)

**Proposed direction**  
`shared/ui/SearchableCombobox` with props: `items`, `selectedId`, `onSelect`, optional `onFreeText`, `renderLabel`. Keep domain naming at call sites (`BeanCombobox` can be a one-line alias).

**ROI**  
Will grow with every “pick bean/blend/product/profile” form. Extract on next form feature, not a standalone PR unless a11y bug forces it.

---

### 5. Entity list CRUD query boilerplate (create/update/delete invalidate)
**Bucket:** B · **Tier:** T2

**Problem**  
Simple CRUD entities repeat the same React Query shape (`useX` / `useCreateX` / `useUpdateX` / `useDeleteX` + `*Keys.all(userId)`). Not wrong — but product/order/sales-channel are near-isomorphic while bean/blend add optimistic variants.

**Evidence**
- Thin pattern: `src/entities/product/queries.ts`, `order/queries.ts`, `sales-channel/queries.ts`  
- Richer pattern: `src/entities/bean/queries.ts` (optimistic + stock key cleanup), `blend/queries.ts`  
- Heavy/domain-specific (do **not** genericize): `plan/queries.ts` (~500 LOC), `cupping/queries.ts` (~360 LOC)

**Proposed direction**  
Optional tiny helper only for the thin path, e.g. `createListCrudHooks({ keys, api })` **or** just a checklist template in docs — not a heavy factory that grows boolean flags. Prefer copy-paste for optimistic/stock side-effects.

**ROI**  
Medium: new entity slices are infrequent; consistency of invalidation (see #2) matters more than hook factory. Only abstract if a third identical thin CRUD lands.

---

### 6. FSD boundary: dashboard/views raw fetch & entity↔entity keys
**Bucket:** B · **Tier:** T2

**Problem**  
Views should orchestrate; some still own `useQuery` + direct `supabase` / entity `api` imports. Entities import other entities for cache keys (forbidden by AGENTS FSD rules).

**Evidence**
- `src/views/dashboard/api/useDashboard.ts` — `useQuery` + `supabase.from('beans')` + direct `beanStockEventApi` / `inventoryAlertApi` / `planBatchApi`  
- `src/views/dashboard/api/useCoffeeFutures.ts`, `useWeather.ts` — view-local queries  
- `src/entities/bean/queries.ts` imports `stockEventKeys` from `../bean-stock-event/queries`  
- Large view god-files: `ActiveRoast.tsx` (~576), `NewProfileModal.tsx` (~678), `AddMachineModal.tsx` (~754)

**Proposed direction**  
1. Move dashboard aggregates into `entities` or a `features/dashboard-summary` with `queries.ts` (api in entities).  
2. Cross-entity invalidation via shared key re-exports or feature-level orchestrators (not entity→entity).  
3. Split god-files by reason-to-change (machine connect vs form chrome; profile create vs session pick) when next feature touches them — not a pure refactor.

**ROI**  
Dashboard is high-traffic; wrong fetch layer makes every inventory change riskier. God-files slow all roast/machine work.

---

### 7. Confirm / danger dialog composition
**Bucket:** A · **Tier:** T2

**Problem**  
Delete/scope/end flows share layout (title, body, cancel, destructive primary) but re-implement panel + button rows. Some use `modalPanel.sm`, some inline older radius/shadow.

**Evidence**
- `src/widgets/bean-detail/ui/DeleteBeanModal.tsx`  
- `src/views/history/ui/DeleteSessionModal.tsx`  
- `src/views/active-roast/ui/EndRoastModal.tsx`  
- `src/widgets/recurring-edit-scope-modal/ui/RecurringEditScopeModal.tsx` / `RecurringDeleteScopeModal.tsx`  
- `src/widgets/complete-batch-modal/ui/CompleteBatchModal.tsx`  
- `src/widgets/stock-deduct-modal/ui/StockDeductModal.tsx`

**Proposed direction**  
`ConfirmDialog` built on `ModalShell` + `modalPanel.sm`: `title`, `description`, `confirmLabel`, `variant: danger|primary`, `onConfirm`, `busy`. Keep domain copy in callers.

**ROI**  
Fewer a11y/escape inconsistencies; lower cost than form-modal work (#1) because fewer screens.

---

### 8. Format helpers consolidation
**Bucket:** B · **Tier:** T2

**Problem**  
`formatDate` exists in two places with different locale behavior; weight formatting only on dashboard path.

**Evidence**
- `src/shared/lib/format.ts` — `formatDate` (hardcoded `en-US`), `formatDateShort`, `formatDuration`, `formatElapsed`  
- `src/views/dashboard/lib/format.ts` — i18n-aware `formatDate` / `formatWeight` / `getGreeting`  
- Pricing money formatting isolated in `src/widgets/cost-calculator/lib/format.ts` (`formatKrw`, pct parsers) — OK if pricing stays locale-KR-first

**Proposed direction**  
Promote dashboard’s locale-aware date/weight into `shared/lib/format.ts`; deprecate view-local duplicates. Leave money/pct in cost-calculator until multi-currency is real.

**ROI**  
Low line count, high correctness when non-EN locales ship (already have `ko`/`ja`/`zh-CN` catalogs).

---

## T3 — Lower priority / defer

### 9. Bean vs product stock-event API symmetry
**Bucket:** B · **Tier:** T3

**Problem**  
Bean stock is rich (summary RPCs, alerts); product stock is a thin `insertMany` + `getStockByUser`. Structural similarity is superficial.

**Evidence**
- `src/entities/bean-stock-event/api.ts`  
- `src/entities/product-stock-event/api.ts`  
- Domain background: `docs/inventory-architecture.md`

**Proposed direction**  
Share only pure parsers/types (`parseStockSummaryJson` already in `stock-calc.ts`). Do **not** unify APIs until product stock needs reservation/horizon parity.

**ROI**  
Low until product inventory deepens; forced abstraction would leak bean-only RPC names.

---

### 10. Edge `_shared` / sidecar helpers
**Bucket:** C · **Tier:** T3

**Problem**  
Edge has small `_shared` (`auth.ts`, `r2.ts`, `slack.ts`, `cupping-score.ts`); client has separate `shared/lib/r2.ts`, `sidecar.ts`. Duplication is thin and intentionally split by trust boundary.

**Evidence**
- `supabase/functions/_shared/*`  
- `src/shared/lib/r2.ts`, `src/shared/lib/sidecar.ts`  
- Sidecar tree under `src-tauri/sidecar` / project `sidecar/`

**Proposed direction**  
Keep server/client separate. Only extract if a third consumer needs the same R2 signing contract (document the contract; don’t share runtime modules across Deno/browser).

**ROI**  
Low; wrong abstraction risks bundling secrets or Deno APIs into client.

---

### 11. Skeleton per-view variants
**Bucket:** A · **Tier:** T3

**Problem**  
`HistorySkeleton`, `OrdersSkeleton`, `CuppingSkeleton`, `BatchCardSkeleton` are layout-specific.

**Evidence**
- `src/views/history/ui/HistorySkeleton.tsx`  
- `src/views/orders/ui/OrdersSkeleton.tsx`  
- `src/views/cupping/ui/CuppingSkeleton.tsx`  
- Primitives: `src/shared/ui/Skeleton.tsx`, `TableSkeleton.tsx`

**Proposed direction**  
Keep view skeletons; continue composing from `Skeleton` / `TableSkeleton`. No “UniversalSkeleton”.

---

## Explicit non-abstractions

Do **not** abstract these even if they look similar (AGENTS SRP + bad-abstraction signals: boolean flags, one-caller generics, type-branching).

| Area | Why keep concrete |
|------|-------------------|
| `plan/api.ts` + `plan/queries.ts` recurrence/range logic | Domain-heavy; one caller family (schedule). Generic “calendar entity” would flag-fork immediately. |
| `cupping/*` scoring + invite mutations | Workflow-specific optimistic trees; not list CRUD. |
| Active-roast signal pipeline (`btFilter`, `chargeOnset`, `tsv-writer`, chart hooks) | Real-time / hardware-adjacent; shared “sensor util” would couple unrelated phases. |
| `cost-calc.ts` pure math vs UI `cost-calculator` widget | Already correctly split; don’t merge UI formatters into pure cost. |
| `blend-stock.ts` vs `batch-stock.ts` vs `stock-calc.ts` | Different reasons-to-change (blend ratio limit vs plan reservation vs summary parse). |
| Radix `Select` vs searchable combobox | Different UX contracts; forcing one primitive creates mode flags. |
| Bean list-detail vs blend list vs profiles master-detail | Selection models differ (stock summary, composition bar, compare mode). `MasterDetailLayout` shell is enough. |
| Entity `api.ts` per table | Thin Supabase wrappers are fine; a generic `createSupabaseCrud('beans')` hides typing and RLS nuances. |
| Sidecar driver configs (`sidecar/config/devices/**`) | Per-machine; shared “driver base” only when a second identical protocol appears. |
| i18n locale JSON catalogs | Duplication of keys is intentional per language, not a code abstraction. |

---

## Suggested implementation order (when prioritizing work)

1. **#2 query keys / plan invalidation** — correctness under `staleTime: Infinity`  
2. **#1 modalPanel + form field tokens** — design consistency, many files  
3. **#3 settings LazyStore singleton** — matches AGENTS, unblocks settings features  
4. **#6 dashboard fetch boundary** — next inventory/dashboard feature  
5. **#4 combobox**, **#7 confirm dialog**, **#8 format** — opportunistic with UI work  
6. Defer **#5, #9–11** unless a concrete feature forces them  

---

## Coverage checklist (acceptance)

| Bucket | Opportunities |
|--------|----------------|
| (A) Design/UI | #1 modal/form tokens, #4 combobox, #7 confirm dialog, #11 skeletons (defer) |
| (B) Domain/logic | #5 CRUD hooks, #6 FSD/dashboard, #8 format, #9 stock-event symmetry (defer) |
| (C) Cross-cutting | #2 RQ keys, #3 LazyStore, #10 edge/sidecar (defer) |

Each entry above includes: problem + path evidence, proposed direction, ROI rationale. Non-abstractions listed explicitly.
