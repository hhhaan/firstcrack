# Page-first FSD inventory

> Classification tour of all route-level `src/views/*` pages under **custom rule #1**:
> **page-owned UI/hooks stay under that page’s view slice** (almost no cross-page sharing).
>
> Layers stay unidirectional (`shared → entities → features → widgets → views → app`) per `Agents.md`.
> Do **not** extract page-only components into `widgets/` / `features/` solely for textbook FSD.
>
> Scope: **analysis only**. Full CQ-R1–R6 rewrites are deferred (cited as risk refs, not this goal’s work).
> Distinguishes **placement** (where page-only UI lives) from **layer duty** (no direct fetch/supabase in views; views orchestrate).

## Placement rule (SSoT for this inventory)

| Decision | When |
|----------|------|
| **keep-in-view** | Used only by one route page (or that page’s internal children). Colocate under `views/<page>/{ui,model,hooks,lib}`. |
| **already-ok** | Already in the correct layer for its reuse surface. |
| **move (optional colocate)** | Lives in `widgets/` but has a **single page consumer** — candidate to fold under that view later; not required now. |
| **true multi-page / shared** | ≥2 pages or app shell consumers → `widgets` / `features` / `entities` as appropriate. |
| **hard violation** | Layer-duty break: reverse imports, cross-view imports, entities↔entities, direct supabase/fetch in views or widgets that should be entities, views calling raw `useQuery`/`useMutation` for domain reads/writes. |

**CQ track (TODOS.md):** CQ-R1 schedule · CQ-R2 machines · CQ-R3 orders · CQ-R4 plan mutations · CQ-R5 shared domain · CQ-R6 dashboard supabase. Deferred unless noted as classification only.

---

## Risk order (maintenance)

| # | Page | ~LOC | Primary risk |
|---|------|------|--------------|
| 1 | schedule | 1425 | God hook `useScheduleDayView` (CQ-R1) |
| 2 | orders | 700 | Monofile tabs 653L (CQ-R3) |
| 3 | active-roast | 4206 | Largest slice; dense feature coupling; sidecar poll in view |
| 4 | history | 1810 | Cross-view imports; large table/compare |
| 5 | machines | 430 | Sidecar poll + connect in view monofile (CQ-R2) |
| 6 | login | 590 | Monofile UI (thin feature already) |
| 7 | cupping | 1308 | Entity mutations called from view UI children |
| 8 | profiles | 1219 | NewProfileModal shared into history (cross-view) |
| 9 | bean | 978 | Single-consumer widgets still in `widgets/` |
| 10 | dashboard | 690 | Widget `useDashboard` direct supabase (CQ-R6) |
| 11 | pricing | 361 | Thin; cost-calculator shared with bean |

---

## 1. schedule

### (a) Current colocated structure

```
src/views/schedule/
  Schedule.tsx                 # entry (month/week/day shell)
  ScheduleDayView.tsx
  MonthView.tsx / WeekView.tsx
  BatchCard.tsx / BatchCardSkeleton.tsx / DayBatchPreview.tsx
  hooks/useScheduleDayView.ts  # src/views/schedule/hooks/useScheduleDayView.ts ~593L god hook
  hooks/useScheduleNav.ts
  lib.ts / lib.test.ts
```

### (b) keep-in-view

- All calendar/day UI: `MonthView`, `WeekView`, `ScheduleDayView`, `BatchCard*`, `DayBatchPreview`
- `useScheduleNav`, pure `lib.ts` date helpers
- **Placement OK** for page-only UI even while the god hook is a **layer-duty** smell

### (c) True multi-page / shared (stay outside view)

| Item | Home | Why |
|------|------|-----|
| plan CRUD / day batches | `@entities/plan` | server state |
| `useDeductRoastStock`, roasting store | `@features/active-roast` | multi-flow stock deduct |
| `add-batch-modal`, `complete-batch-modal`, `recurring-edit-scope-modal` | `@widgets/*` | modal blocks; only schedule consumes today but modal pattern matches widgets |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| Features-grade orchestration in view hook | `useScheduleDayView.ts` — create/update/delete/reorder/complete + RRULE + stock deduct + queryClient | **features** scenario hooks (`complete-batch`, `edit-recurrence`, …); view keeps UI state only — **CQ-R1** (defer rewrite) |
| `useQueryClient` invalidate in view | same file | feature mutations own invalidation |

**Placement decision:** keep calendar UI in view; extract **actions** not layout when touching CQ-R1.

---

## 2. orders

### (a) Current colocated structure

```
src/views/orders/
  Orders.tsx           # src/views/orders/Orders.tsx ~653L — tabs: orders | products | channels inline
  ui/OrdersSkeleton.tsx
```

### (b) keep-in-view

- Tab shell, `OrdersTab` / `ProductsTab` / `ChannelsTab` / row components (once split)
- Status tone helpers if page-only (prefer i18n locales over EN hardcode — CQ-R3 note)

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| `useOrders`, `useOrderDispatches`, products, sales-channel | entities | server state |
| `useFulfillOrder`, `useCancelOrder`, `DispatchModal`, `usePackageProduct` | features | single user actions |
| `AddOrderModal`, `AddProductModal`, `ConnectChannelModal` | widgets | composed modals |
| `RoastingRequirementsCard` | widgets (or colocate) | **single consumer: Orders only** |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| God file SRP | `Orders.tsx` 653L multi-tab | **keep under views/orders/ui/** tab files — **CQ-R3** (split in place; do not push tabs to widgets) |
| `usePackageProduct` also used from Beans | feature already correct | stay in features |

**Placement decision:** split tabs **into** `views/orders/ui/*` (page-first). Optional: fold `roasting-requirements-card` under `views/orders/ui/`.

---

## 3. active-roast

### (a) Current colocated structure

```
src/views/active-roast/
  ActiveRoast.tsx              # ~597L orchestration entry
  model/  useChart*, useRoast*, useSidecarPolling (~279L)
  ui/     RoastTempChart, RoastSidePanel, RoastSummaryModal, …
  lib/    display-derivatives, roast-phase
```

Heavy domain already in `@features/active-roast` (settings, log, save, chart-config, colors).

### (b) keep-in-view

- Page chrome: `RoastHeader`, `RoastChartContainer`, `RoastSidePanel`, `EventButtons`, `LiveReadings`, modals
- Chart pipeline/zoom/keyboard hooks that only serve this screen’s chart
- `display-derivatives` (view presentation)

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| `features/active-roast/*` | features | session, save, alerts, temps — reused (history scorecard, settings, profile-detail) |
| entities: profile, roast-profile, plan, organization | entities | server state |
| `RoastTempChart` | currently view | **also imported by history** → true multi-page; should live in **widgets** or **features/active-roast/ui** |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| Sidecar polling in view | `model/useSidecarPolling.ts` ~279L | features/active-roast (CQ-R6 note / TODOS) |
| Cross-view: History imports chart | `HistoryTable.tsx` → `@views/active-roast/ui/RoastTempChart` | move chart to features/widgets |

**Placement decision:** page UI stays; only multi-consumer pieces leave the view.

---

## 4. history

### (a) Current colocated structure

```
src/views/history/
  History.tsx              # src/views/history/History.tsx
  hooks/useHistoryFilters.ts
  ui/ HistoryTable, SessionCompareModal, SessionScorecard, DeleteSessionModal, …
  ui/compare/*
```

### (b) keep-in-view

- Table, filters orchestration, delete modal, compare modal + compare/*
- `useHistoryFilters` (page filter state)

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| roast sessions / delete / update weight | `@entities/roast` | server state |
| `useExportCsv` | features | action |
| `DateRangeFilter` | widgets | reusable filter (history-only consumer today, but generic UI) |
| `sessionFilter` pure helpers | shared (CQ-R5: could be entities/roast/lib later) | pure, non-UI |
| `NewProfileModal` | today `@views/profiles` | **shared with Profiles** → should not be view→view |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| Cross-view import | `History.tsx` → `@views/profiles/NewProfileModal` | widgets or features/create-profile; both pages import |
| Cross-view import | `HistoryTable.tsx` → `@views/active-roast/ui/RoastTempChart` (`src/views/active-roast/ui/RoastTempChart`) | features/active-roast/ui or widgets/roast-temp-chart |

**Placement decision:** keep history UI in view; **fix cross-view imports** when next touching those files (classification: hard violation).

---

## 5. machines

### (a) Current colocated structure

```
src/views/machines/
  Machines.tsx   # src/views/machines/Machines.tsx ~430L monofile — list, detail, connect, poll, delete
```

### (b) keep-in-view

- Master-detail layout wiring, machine list/detail presentation, confirm modals that are page-only
- (After CQ-R2) thin orchestration calling a connection hook

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| `useMachines`, machine types | entities/machine | server + domain |
| `AddMachineModal`, `useMachinesPageState` | widgets/add-machine-modal | modal + page form state |
| roasting store (active connection identity) | features/active-roast | shared session |
| `sidecar` client | shared/lib | infra |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| useEffect + setInterval sidecar poll / connect in view | `Machines.tsx` | **features/machine-connection** — **CQ-R2** |
| Reverse type import | `shared/lib/sidecar.ts` → `@entities/machine` types | move types to shared or keep client in entities (CQ-R6) |

**Placement decision:** do not invent widgets for the list UI; extract **connection polling** only.

---

## 6. login

### (a) Current colocated structure

```
src/views/login/
  Login.tsx   # ~590L monofile UI + form
```

### (b) keep-in-view

- Entire login presentation (page-only; no other consumer)

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| `useLogin` | `@features/auth` | auth action — already correct |

### (d) Hard violations / notes

- None hard. Optional SRP split of presentational sections under `views/login/ui/` if editing — **keep-in-view**, not features.

**Placement decision:** already-ok under page-first rule.

---

## 7. cupping

### (a) Current colocated structure

```
src/views/cupping/
  Cupping.tsx
  ui/ CuppingEventList, CuppingEventDetail, CuppingAddSamplesForm,
      CuppingSampleSummary, CuppingScoreList, CuppingResultsShare,
      CuppingSessionInvite, CuppingSkeleton
```

### (b) keep-in-view

- All `ui/*` — only Cupping route uses them

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| cupping events/samples/scores/invites | `@entities/cupping` | server state + mutations |
| roast sessions picker data | `@entities/roast` | read |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| View UI calls entity mutations directly | e.g. `CuppingEventList` `useCreateCuppingEvent`, `CuppingResultsShare` + `useQueryClient` | acceptable short-term if entities own write API; ideal: feature hooks per action (create-event, share-results). **Not** widgets. |
| Mutations mixed in entity queries | entities/cupping (CQ-R4 pattern) | defer plan-first CQ-R4 |

**Placement decision:** keep UI in view; no extract to widgets.

---

## 8. profiles

### (a) Current colocated structure

```
src/views/profiles/
  Profiles.tsx
  NewProfileModal.tsx          # also imported by history (cross-view)
  model/useNewProfileForm.ts
  ui/ ProfileFormBody, ProfileCurveFields, ProfileModePicker, …
  lib/
```

### (b) keep-in-view

- List/detail shell in `Profiles.tsx`
- Form field UI under `ui/` (if only profiles + new-profile flow)

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| `ProfileDetail`, `ProfileCompare` | widgets | detail/compare blocks |
| `profile-curve-chart` | widgets | **multi-consumer** (profile-detail, history table/compare, profile-compare) — true shared |
| roast-profile / profile entities | entities | server state |
| `NewProfileModal` + form | today view; **History imports it** | → widgets or features when fixing cross-view |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| Cross-view export | History → `@views/profiles/NewProfileModal` | widgets/new-profile-modal or features |
| Form orchestration in view model | `useNewProfileForm` (TODOS CQ-R6 “pricing / new profile form → features”) | optional feature when multi-entry; until then keep-in-view is fine under page-first **except** history reuse |

**Placement decision:** `ProfileDetail` single-page → optional colocate under views/profiles; `profile-curve-chart` stays widgets.

---

## 9. bean

### (a) Current colocated structure

```
src/views/bean/
  Beans.tsx
  model/useGreenInventoryAssets.ts
  ui/ InventoryTabBar, InventoryLocked, ProductsTab, RoastedInventoryTab
```

### (b) keep-in-view

- Tab bar, locked gate, products/roasted tabs, green asset model

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| beans/blends/products stock APIs | entities | server state |
| `BlendRoastedModal`, stock adjust features | features | actions |
| `AddBeanModal`, `AddBlendModal` | widgets | modals (bean-only consumers) |
| `BeanList`, `BeanDetail`, `BlendList` (+ blend-detail) | widgets | **single-page consumers (bean)** except blend-list also used by cost-calculator SourcePanel |
| `cost-calculator/lib/format` currency helpers | widgets | **shared with pricing + bean UI** — true shared util; better as shared/lib long-term |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| View orchestrates product stock APIs + queryClient | `Beans.tsx` | ok as orchestration if no raw supabase; prefer feature for package/adjust already used in ProductsTab |
| Single-consumer widgets | bean-list, bean-detail | optional future colocate under `views/bean/ui/` — **classification only** |

**Placement decision:** keep tabs in view; list/detail widgets are optional colocate candidates, not violations.

---

## 10. dashboard

### (a) Current colocated structure

```
src/views/dashboard/
  Dashboard.tsx
  components/ DashboardHeader, KpiSection, KpiCard, MonthlyChartSection,
              RecentSessionsTable, UpcomingBatches, InventoryAlerts
  lib/ constants.ts, format.ts
```

### (b) keep-in-view

- All `components/*` and `lib/*` — dashboard-only presentation

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| `useDashboard` | widgets/dashboard-summary | **only Dashboard consumers** — data hook + types |
| weather / coffee-futures | shared/api | generic external |
| inventory alerts entity | entities | used by sidebar/banner too |

### (d) Hard violations / notes

| Issue | Evidence | Recommended home |
|-------|----------|------------------|
| Widget direct supabase | `widgets/dashboard-summary/api/useDashboard.ts` imports `@shared/lib/supabase` and queries | **entities** (dashboard or multi-entity compose) — **CQ-R6** |
| Types imported from widget into view | `components/*` import types from useDashboard | after CQ-R6, types live with entities |

**Placement decision:** UI stays in view. Data layer is the violation, not placement of KPI cards.

---

## 11. pricing

### (a) Current colocated structure

```
src/views/pricing/
  Pricing.tsx
  model/usePricingCalculator.ts
```

### (b) keep-in-view

- Page shell wiring source selection + result layout
- Calculator model if only pricing uses the full flow (format helpers are shared)

### (c) True multi-page / shared

| Item | Home | Why |
|------|------|-----|
| `CostBreakdown`, `PricingResultPanel`, `SourcePanel` | widgets/cost-calculator | composed calculator UI |
| beans/blends queries | entities | server state |
| currency format helpers | used by bean widgets too | true shared → prefer `@shared/lib` or keep in cost-calculator lib |

### (d) Hard violations / notes

- No hard cross-view. TODOS suggested “pricing form → features” — only if a second entry point appears; under page-first, **keep model in view** is fine.

**Placement decision:** already-ok; cost-calculator correctly shared with bean display.

---

## Hard violations summary (evidence-backed)

| # | Kind | Location | Grep / read evidence | Recommended home |
|---|------|----------|----------------------|------------------|
| V1 | Cross-view import | history → profiles | **fixed** → `@widgets/new-profile-modal` | — |
| V2 | Cross-view import | history → active-roast | **fixed** → `@features/active-roast/ui/RoastTempChart` | — |
| V3 | Widget supabase | dashboard-summary | **fixed** → `roastSessionApi.listCompleted*` + other entity APIs | — |
| V4 | View sidecar poll | machines | **fixed** → `@features/machine-connection` | — |
| V5 | View god orchestration | schedule | `useScheduleDayView.ts` plan mutations + stock (partial: error helper extracted) | features scenarios (CQ-R1 remainder) |
| V6 | entities↔entities | roast, order-dispatch, … | e.g. `entities/roast/queries.ts` → bean-stock-event keys | shared query-keys hub (partially exists) |
| V7 | shared→entities reverse | sidecar | `shared/lib/sidecar.ts` type import `@entities/machine` | shared types or entity client |
| V8 | View god monofile | orders | **fixed** → `views/orders/ui/{Orders,Products,Channels}Tab.tsx` (CQ-R3) | — |

**Not counted as placement violations:** large page-local UI under `views/*` (desired under custom rule #1).

---

## Optional colocate map (single-consumer widgets → future views/*)

Classification only — **no moves required for this inventory to pass**.

| Widget | Sole / primary consumer | Optional home |
|--------|-------------------------|---------------|
| `bean-list` | Beans | `views/bean/ui/` |
| `bean-detail` | Beans | `views/bean/ui/` |
| `profile-detail` | Profiles | `views/profiles/ui/` |
| `profile-compare` | Profiles | `views/profiles/ui/` |
| `roasting-requirements-card` | Orders | `views/orders/ui/` |
| `dashboard-summary` | Dashboard | keep widget **or** `views/dashboard/model/` after entities extract for data |
| `add-bean-modal` | Beans | `views/bean/ui/` or stay widgets (modal convention) |
| `add-blend-modal` | Beans | same |
| `add-machine-modal` | Machines | same |
| `add-order-modal` | Orders | same |
| `connect-channel-modal` | Orders | same |
| `complete-batch-modal` | Schedule | same |
| `date-range-filter` | History only today | keep widgets if intended generic |

**Stay widgets (true multi-page or shell):**

| Widget | Consumers |
|--------|-----------|
| `profile-curve-chart` | profile-detail, history, profile-compare |
| `cost-calculator` | pricing + bean list/detail |
| `blend-list` | Beans + cost-calculator SourcePanel |
| `add-product-modal` | Orders + Beans ProductsTab |
| `sidebar`, `settings-modal`, theme/stock/today modals | app shell |

---

## Layer direction (must not contradict)

```
shared → entities → features → widgets → views → app
```

Custom rule #1 only changes **where page-private UI is allowed to live** (prefer `views/<page>` over premature widgets). It does **not** allow:

- views → reverse into features/entities implementation details beyond consumption
- views importing other views
- widgets/entities skipping to raw supabase when an entity query exists
- entities importing entities (use shared keys/types)

---

## Deferred (explicit non-goals of this doc)

- Implementing CQ-R1–R6 or SRP rewrites
- Moving single-consumer widgets into views
- Classic FSD pressure to “extract everything shared”
- Backend / sidecar / i18n / new product features
