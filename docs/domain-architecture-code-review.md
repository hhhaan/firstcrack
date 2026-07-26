# Domain architecture & code-smell review

> **Date:** 2026-07-21  
> **Scope:** Multi-domain read-only review (smell / readability / architecture). Documentation only — no production fixes in this pass.  
> **Method:** Live tree inventory + ~10 parallel domain explorers + cross-cutting FSD greps. Findings cite real paths; severity is prioritization aid only (P0–P3 / high–low).  
> **Rubric:** AGENTS.md FSD (shared → entities → features → widgets → views), SRP, queries=reads / writes=useX or features, views orchestration-only, shared = zero domain knowledge.

---

## Domain map (10 tracks)

| # | Domain | Primary tree |
|---|--------|--------------|
| 1 | Active roast / session | `src/views/active-roast`, `src/features/active-roast`, `src/entities/roast`, `src/shared/store/roastSession.ts` |
| 2 | Inventory + stock events | `src/entities/{bean,bean-stock-event,roasted-stock-event,product-stock-event,inventory-alert}`, `src/features/{adjust-*,blend-roasted,package-product}`, `src/views/bean` |
| 3 | Orders + sales channel + dispatch | `src/entities/{order,order-dispatch,sales-channel,product}`, `src/features/{fulfill,cancel,dispatch}-order*`, `src/views/orders` |
| 4 | Schedule / plan | `src/entities/plan`, `src/views/schedule`, schedule widgets, `src/shared/lib/{rrule,batch-stock}.ts` |
| 5 | History + roast profiles | `src/views/{history,profiles}`, `src/entities/roast-profile`, `src/features/{export-csv,upload-roast-profile}`, profile widgets |
| 6 | Sidecar + machines | `src-tauri/sidecar/**`, `src-tauri/src/lib.rs`, `src/entities/machine`, `src/views/machines`, `src/features/sidecar`, `src/shared/lib/sidecar.ts` |
| 7 | Auth / org / team | `src/features/{auth,team-invite}`, `src/entities/{organization,profile}`, `src/views/login`, `src/shared/store/auth.ts`, settings team tab |
| 8 | Shared / FSD boundaries | `src/shared/**`, `src/App.tsx`, import graph greps |
| 9 | Supabase edge + migrations | `supabase/functions/**`, `supabase/migrations/**`, `supabase/config.toml` |
| 10 | Dashboard + cupping + pricing | `src/views/{dashboard,cupping,pricing}`, `src/widgets/dashboard-summary`, `src/entities/cupping`, `src/shared/api/{weather,coffee-futures}.ts` |

---

## Executive summary

| Strengths | Systemic risks |
|-----------|----------------|
| features↔features cross-slice imports ≈ 0 | Fat view hooks (`useScheduleDayView` ~593L, `ActiveRoast` ~597L, `Orders.tsx` ~653L) |
| Plan API split done (`entities/plan/api/*`) | `queries.ts` still holds most writes (plan 13 mutations, cupping 10) |
| Chart option extraction done (`RoastTempChart` ≤350L + `lib/chart-option`) | Domain gravity in `shared/lib` (stock/batch/roast/plan gates) |
| Session roast path atomic via `save_roast_op` | Residual entities↔entities key imports for invalidation |
| R2 presign + channel secrets off client | Edge bugs: wrong table for auto-fulfill; channel-connect secrets ownership gap |
| Pure builders + tests in active-roast / packaging / blend | Dual registries (Python vs TS) for machines |

**Highest leverage refactors (architecture, not product roadmap):**

1. Split `useScheduleDayView` into features; fix dayBatches optimistic key vs lookback `14`.
2. Thin god views (`ActiveRoast`, `Orders`, cupping `ui/*` fetch) — compose only.
3. Invalidation only via `shared/lib/query-keys` roots — drop entities→entities key imports.
4. Fix edge `order-dispatch` table + `channel-connect` ownership (correctness/security).
5. Move domain pure-fns out of `shared/` on touch; invert `sidecar.ts` type import.

---

## Cross-cutting FSD / layer issues

Evidence from greps (2026-07-21). Tags: **architecture** unless noted.

### entities → entities (forbidden)

| Path | Import | Notes |
|------|--------|--------|
| `src/entities/roast/queries.ts:1-2` | `@entities/bean-stock-event`, `@entities/roasted-stock-event` | invalidate foreign keys on roast delete / output weight |
| `src/entities/order-dispatch/queries.ts:1,28` | `@entities/product-stock-event` | product stock invalidate on dispatch path |
| `src/entities/bean/queries.ts:3` | relative `../bean-stock-event/queries` | removeQueries on bean delete |

**Mitigation already partial:** `src/shared/lib/query-keys.ts` exposes `inventoryQueryRoots`, `planQueryRoots`, `orderKeys` — roast still also imports entity key factories.

### shared → upper

| Path | Issue |
|------|--------|
| `src/shared/lib/sidecar.ts:1` | `import type … from '@entities/machine'` — invert: types live in shared or next to client |
| `src/shared/lib/query-keys.test.ts` | test imports entity keys (acceptable test debt) |
| `src/shared/i18n/history-delete-description.test.ts` | imports view component (layer leak in test) |

### features → features (cross-slice)

**None found.** Same-slice only (`@features/active-roast/*`, `@features/auth/*`).

### views: fetch / raw API / cache writes

| Path | Pattern |
|------|---------|
| `src/views/schedule/hooks/useScheduleDayView.ts` | 10+ entity mutations + `dayPlanApi` / `planBatchApi` + manual `qc.invalidateQueries` |
| `src/views/bean/Beans.tsx:51-65` | `prefetchQuery` + raw `*StockEventApi` |
| `src/views/active-roast/model/useRoastSaveFlow.ts:73` | `beanStockEventApi.hasRoastDeductionForReference` |
| `src/views/cupping/ui/CuppingResultsShare.tsx:37-50` | `cuppingApi.ensureResultsToken` + `qc.setQueryData` |
| `src/views/cupping/ui/*` | systemic entity hook usage (list/detail/samples/scores) |
| `src/views/machines/Machines.tsx` | `useEffect` + `setInterval` → `sidecar.*` (NO useEffect fetch rule) |

**Healthy:** no `supabase` / axios imports under `src/views` (refactor T1 residual fixed). No `useQuery`/`useMutation` *definitions* in views (consume only).

### Domain in shared (zero-domain violated)

| Path | ~LOC | Suggested home |
|------|------|----------------|
| `shared/lib/stock-calc.ts` | 49 | plan / bean-stock-event |
| `shared/lib/batch-stock.ts` | 61 | plan |
| `shared/lib/blend-stock.ts` | — | blend |
| `shared/lib/roastWeight.ts` | 47 | roast |
| `shared/lib/roast-delta.ts` | — | roast / active-roast |
| `shared/lib/sessionFilter.ts` | 95 | roast / history feature |
| `shared/lib/carriers.ts` | 11 | order-dispatch |
| `shared/lib/cost-calc.ts` | — | pricing / product |
| `shared/lib/features/*` (plan matrix) | — | org / billing policy |
| `shared/data/roast-profiles.ts` | 33 | roast-profile |
| `shared/api/coffee-futures.ts` | — | dashboard widget (hardcoded project URL smell) |
| `shared/api/weather.ts` | — | dashboard widget |

**Legitimate shared:** `query-keys` roots, supabase client, logger, rrule (generic), tsv-writer, settings store, UI primitives, format/cn/stats.

### queries.ts = reads + writes (convention drift)

`useMutation` counts in entity `queries.ts` (still true):

| Slice | useMutation ≈ |
|-------|----------------|
| plan | 13 (`queries.ts` ~528L) |
| cupping | 10 (`queries.ts` ~542L) |
| sales-channel | 6 |
| organization | 5 |
| roast / roast-profile / product / blend / bean | 4 each |

Features already own some writes (`useFulfillOrder`, `usePackageProduct`, `useSaveRoast`, …) → **dual hierarchy**.

### Mutation error UX

`src/main.tsx:17-23`: `MutationCache.onError` → `logger.capture` in PROD only — **not** user toast. Prior audit P1 only partially addressed (observability, not UX).

---

## 1. Active roast / session

### Hotspots

| Path | ~LOC |
|------|------|
| `views/active-roast/ActiveRoast.tsx` | 597 |
| `views/active-roast/ui/RoastSummaryModal.tsx` | 588 |
| `features/active-roast/ui/RoastTempChart.tsx` | 350 |
| `features/active-roast/model/useSaveRoast.ts` | 317 |
| `views/active-roast/model/useSidecarPolling.ts` | 279 |

### Findings

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | God orchestration view: settings + 3 stores + chart + save + lifecycle | `ActiveRoast.tsx` |
| architecture | high | Dual clock/run flags (`roastStartTimeRef` vs store; local `isRunning` vs `isRoasting`) | view + `status` store |
| architecture | high | `useSidecarPolling` multi-reason: connect, poll/filter, TSV, BBP, elapsed | `useSidecarPolling.ts` ~279L |
| architecture | med | View components fetch (`RoastSummaryModal` beans/dayBatches; header beans) | summary modal L99+ |
| architecture | med | Mega-feature slice (session + save + stock deduct used by schedule) | `features/active-roast/**` |
| smell | med | Barrel self-import in auto-detect | `useAutoDetection.ts` `@features/active-roast` |
| readability | med | Prop explosion chart/side panel | `RoastChartContainer` / `RoastSidePanel` |
| smell | low | `RoastSummaryModal` form+data+layout | ~588L |

### Healthy

- Chart builders extracted: `views/active-roast/lib/chart-option/*` + tests.
- `saveRoastCore` injectable + `save_roast_op` RPC (session path atomic).
- Pure libs tested (charge onset, turning points, stock builders, serialize events).
- `roastSession` store non-persist handoff.

### Top 3

1. Single SSoT for roast clock / run flags.  
2. Split `useSidecarPolling`.  
3. Thin `ActiveRoast` / move save-flow API guards into feature.

---

## 2. Inventory + stock events

### Hotspots

- Dual alert RPC: `bean-stock-event/api.ts` + `inventory-alert/api.ts` (`computeInventoryAlerts`)
- `usePackageProduct.ts`, `useDeductRoastStock.ts`, `Beans.tsx` prefetch
- Shared stock math (see cross-cutting table)

### Findings

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | entities↔entities key coupling | `bean/queries.ts:3`, `roast/queries.ts:1-2` |
| architecture | high | Domain calc in shared | `stock-calc`, `batch-stock`, `roastWeight`, `blend-stock` |
| architecture | med | View raw API prefetch / deduct guard | `Beans.tsx:51-65`, `useRoastSaveFlow.ts:73` |
| architecture | med | Writes in `queries.ts` | bean / bean-stock-event / inventory-alert |
| smell | high | Duplicate `computeInventoryAlerts` | two entity APIs |
| smell | high | `onSettled` await alert RPC can fail successful insert UX | `bean-stock-event/queries.ts` ~82-92 |
| smell | med | Deduct invalidation incomplete vs insert path | `useDeductRoastStock.ts` |
| smell | med | opId created inside mutation (retry ≠ idempotent) | package / blend / adjust hooks |
| integrity | high | Session path atomic (`save_roast_op`); schedule deduct still separate `insertMany` + dual reference risk | `useSaveRoast.ts`, `useDeductRoastStock.ts` |

### Healthy

- Append-only three ledgers; packaging / batch RPCs; pure builders + tests.
- `inventoryQueryRoots` for cross-slice invalidation.
- Optimistic rollback pattern on several writes.

### Top 3

1. Invalidation via shared roots only; drop entity key imports.  
2. Single alert RPC owner; fire-and-forget compute after insert.  
3. Client safety: blend caps, stable opId, expected_inbound consume, stop view raw API.

---

## 3. Orders + sales-channel + dispatch

### Hotspots

| Path | ~LOC |
|------|------|
| `views/orders/Orders.tsx` | ~653 |
| `widgets/connect-channel-modal/...` | ~298 |
| `widgets/add-product-modal/...` | ~252 |

### Findings

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | Fat multi-tab view: eligibility, EN maps, packaging prompt, channel hooks | `Orders.tsx` |
| architecture | high | Half-migrated writes: fulfill/cancel in features; create/dispatch/channel in entity | features vs `entities/*/queries` |
| architecture | med | entities↔entities `productStockKeys` | `order-dispatch/queries.ts` |
| smell | med | Fulfill/cancel no pending disable / error surface | `Orders.tsx` buttons |
| smell | med | `window.prompt` packaging; dual Products UX vs bean tab | `Orders.tsx` ~384-388 |
| readability | med | Hardcoded EN status maps | `Orders.tsx` ~47-76 |
| smell | low | `channels.refetch()` in connect modal | `ConnectChannelModal.tsx:82` |
| smell | low | `usePackageProduct` raw `supabase.from('products')` | feature model |

### Healthy

- Fulfill/cancel RPCs + mirrored invalidation; packaging pure builders + optimistic path.
- Edge holds channel secrets; client invoke only.
- Dispatch modal handles platform-fail vs fulfillError without silent close.

### Top 3

1. Split `Orders.tsx` into tab UI + pure eligibility/labels.  
2. Normalize user-action writes into features; fix productStock key import.  
3. Mutation UX + unify packaging with inventory ProductsTab.

---

## 4. Schedule / plan

### Hotspots

| Path | ~LOC |
|------|------|
| `views/schedule/hooks/useScheduleDayView.ts` | ~593 |
| `entities/plan/queries.ts` | ~528 |
| `entities/plan/api/plan-batch.ts` | ~254 |

### Findings

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | Feature-layer orchestrator parked in views | `useScheduleDayView.ts` (10 mutations + modal + stock + materialize) |
| architecture | high | Writes outside RQ mutations (`materialize`, `getOrCreate`, `move` + ad-hoc invalidate) | same hook L119+, L270+, L333+ |
| architecture | med | `queries.ts` SRP bag (keys + patch + all mutations) | `entities/plan/queries.ts` |
| architecture | med | `useDayPlan` write-on-read (`getOrCreate` in queryFn) | `queries.ts` ~122-128 |
| smell | high | Optimistic dayBatches key **without** lookback; live query uses lookback `14` → dead optimistics | hook L76 `useDayBatches(..., 14)` vs `planKeys.dayBatches(userId, date)` in mutations |
| smell | med | Virtual batch id via `id.includes(':')` | hook L120, L275 |
| smell | low | Duplicated rrule label parse | `views/schedule/lib.ts` vs `shared/lib/rrule.ts` |
| readability | med | Dense scope edit/delete + status transition branches | `commitStatusTransition`, `handleEditScopeUpdate` |

### Healthy

- API split under `entities/plan/api/*` (T3 done).  
- Recurrence expand in `list-for-date-range.ts` + tested rrule.  
- Widgets mostly callback-driven; week/month views thin.  
- `queries.invalidation.test.ts` present.

### Top 3

1. Split `useScheduleDayView` into features.  
2. Align optimistic keys with lookback key shape (or always prefix-match patch).  
3. Slice `plan/queries.ts`; funnel materialize/move through mutations only.

---

## 5. History + roast profiles

### Findings

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | Domain pure-fns in shared | `roast-profiles.ts`, `sessionFilter.ts`, `roast-delta.ts` |
| architecture | high | Leaf view components fetch (ExpandedRow chart + profiles) | `HistoryTable.tsx` ~148-156 |
| architecture | med | View→view imports | History/Profiles → `@widgets/new-profile-modal`; HistoryTable → `@features/active-roast/ui/RoastTempChart` (fixed) |
| smell | high | Duplicate profile chrome (DefaultBadge / fmtDuration / table rows) | ProfileDetail vs ProfileCompare |
| smell | med | Dual pagination (server page vs full list for search/compare/export) | `History.tsx` |
| smell | med | Magic defaults 200°C / 720s reimplemented | Profiles, ProfileDetail, Compare |
| readability | high | HistoryTable multi-reason (layout + expand chart + profile overlay) | ~465L |

### Healthy

- `export-csv`, `upload-roast-profile` thin features.  
- Profile curve chart presentational + pure plot lib.  
- Entity keys/invalidation for sessions/profiles generally clear.

### Top 3

1. Move session/profile pure helpers into entities.  
2. Lift expand-row data; stop view→active-roast chart import (shared chart primitive or widget).  
3. Single curve resolve path (`useResolvedProfileCurve`).

---

## 6. Sidecar + machines

### Hotspots

| Path | ~LOC |
|------|------|
| `src-tauri/sidecar/roaster_registry.py` | 1538 |
| `src/entities/machine/roasterRegistry.ts` | 651 |
| `src-tauri/sidecar/manager.py` | 530 |
| `src/views/machines/Machines.tsx` | 448 |
| `src-tauri/sidecar/main.py` | 350 |
| `src-tauri/src/lib.rs` | 338 |

### Findings

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | Dual registry drift (Python SSoT unused by client; `/roasters` admitted unused) | `main.py` ~327; static `roasterRegistry.ts` |
| smell | high | Phidget silent fail `bt=-1.0` → manager keeps EMA, no reconnect | `adapters/phidget.py` ~84-93; `manager.py` read path |
| smell | high | Connect timeout skew (client 5s vs Kaleido 15s / Phidget 10s) | `sidecar.ts` vs adapters |
| architecture | med | Duck-typed adapters; no Protocol beyond `Reading` | `adapters/base.py`, manager `hasattr` |
| architecture | med | Machines view owns poll/connect | `Machines.tsx` setInterval + sidecar client |
| smell | med | Respawn drops `SIDECAR_VERSION` env | `lib.rs` initial vs respawn |
| smell | med | Unauth localhost :9999 mutating routes | `main.py` |
| architecture | low | `features/sidecar` only dead-listener; underused | ~20L feature |

### Healthy

- Adapter factory; parent watchdog; stale-read tolerance; custom address maps.  
- Bind 127.0.0.1; CORS allowlist.  
- Add-machine form split (`useAddMachineForm` etc.) — T6a largely done (~113L modal).

### Top 3

1. Phidget fail-open → raise so stale/reconnect runs.  
2. Wire `GET /roasters` or codegen dual registry.  
3. Longer connect timeout + optional local token on mutating routes.

---

## 7. Auth / org / team

### Findings

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | Dual OAuth exchange (App DEV reimplements feature helper) | `App.tsx` ~74-98 vs `features/auth/lib/oauthCallback.ts` |
| architecture | high | Plan fetch in shared auth store (domain I/O + untyped `as Plan`) | `shared/store/auth.ts` ~47-56 |
| architecture | med | Team writes split: features wrap create/redeem/remove; revoke still entity | `TeamSettingsTab.tsx` ~25-28 |
| smell | med | Same-user early return skips plan re-sync | `auth.ts` ~101-104 |
| smell | low | `profileApi.get` swallows errors | `entities/profile/api.ts` |
| readability | med | Login wall of inline styles + EN copy | `Login.tsx` ~590L |

### Healthy

- Login view does not call supabase (uses `useLogin`).  
- `mapAuthError` / `mapInviteError` stable codes.  
- No service_role in client paths reviewed.

### Top 3

1. Unify OAuth via feature helper only.  
2. Plan SSOT via profile entity / query + invalidate on billing.  
3. All org invite writes under features (incl. revoke).

---

## 8. Shared / FSD boundaries (+ App)

Covered in **Cross-cutting** above. Additional App notes:

| Tag | Finding | Evidence |
|-----|---------|----------|
| architecture | Shell owns auth I/O, keep-alive display hacks for roast/machines | `App.tsx` |
| architecture | Active-roast deep imports from views/widgets into feature internals | e.g. chart-config, temperature |

**Systemic priorities:** empty domain from shared → fix entities→entities → invert sidecar types → thin fat views → stable public feature APIs.

---

## 9. Supabase edge + migrations

### Functions (inventory)

| Function | Auth notes |
|----------|------------|
| `get-upload-url` / `get-download-url` | JWT; R2 presign ≤300s; path ownership |
| `create-polar-checkout` / `polar-webhook` | JWT / HMAC + service_role |
| `notify-signup` | shared secret |
| `coffee-futures` | none (public proxy) |
| cupping public trio | invite/results tokens + service_role |
| cafe24 OAuth + channel connect/disconnect | JWT / signed state |
| `order-sync` / `order-webhook` / `order-dispatch` | JWT / HMAC / cron secret |

### Findings

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| smell | high | ~~**Bug:** auto-fulfill reads `sales_channels` not `sales_channel_connections`~~ **fixed** (#123) — table name corrected, lookup error now logged | `order-dispatch/index.ts` ~208-212 |
| architecture | high | **Security smell:** channel-connect can upsert secrets when ownership update matches 0 rows if client supplies foreign `connectionId` | `channel-connect/index.ts` ~107-145 |
| architecture | med | `config.toml` may not list all functions' `verify_jwt` (webhook/cron risk vs dashboard overrides) | `supabase/config.toml` |
| smell | med | Polar fallback `external_id ?? customer_id` | `polar-webhook` |
| architecture | med | Client `FOR ALL` on orders can set status/`fulfilled_at` outside ledger path | migrations / RLS pattern |
| smell | low | Duplicated `serviceClient()` helpers | multiple functions |
| architecture | healthy | R2 contract matches Agents.md | `_shared/r2.ts`, `shared/lib/r2.ts` |
| architecture | healthy | `sales_channel_secrets` no client policies | migrations |

### Top 3

1. Fix `channel-connect` ownership before secrets upsert.  
2. ~~Fix `order-dispatch` → `sales_channel_connections` (+ verify fulfill).~~ done (#123).  
3. Align `verify_jwt` for webhook/cron with production runtime.

---

## 10. Dashboard + cupping + pricing

### Dashboard

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | Multi-domain BFF in widget with raw `roast_sessions` SQL | `widgets/dashboard-summary/api/useDashboard.ts` ~84-115 |
| smell | med | Coarse `dashboardKeys.all` invalidation | entity invalidators |
| architecture | low | Widget is api-only; UI lives under `views/dashboard/components` | naming mismatch |
| healthy | — | `Dashboard.tsx` itself is thin orchestration | compose only |

### Cupping

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | high | Nearly all `views/cupping/ui/*` call entity hooks | EventDetail, List, Samples, Scores, Share, … |
| architecture | med | Fat `api.ts` (~449L) + `queries.ts` (~542L) | events/samples/invites/scores + dual-cache invites |
| smell | med | Delete path still `refetch()` after optimistic delete | `Cupping.tsx` ~54-57 |
| smell | med | `ensureResultsToken` ad-hoc in view + setQueryData | `CuppingResultsShare.tsx` |
| readability | med | Invite dual-cache orchestration hard to reason | `queries.ts` |

### Pricing

| Tag | Sev | Finding | Evidence |
|-----|-----|---------|----------|
| architecture | low/med | View thin; fat calculator hook owns beans/blends + local store | `usePricingCalculator.ts` ~287L |
| readability | med | Large prop surface into SourcePanel | cost-calculator widgets |
| smell | med | `coffee-futures` hardcodes project Supabase URL | `shared/api/coffee-futures.ts:4` |

### Top 3

1. Cupping: containers/features for fetch; drop post-delete `refetch`; mutation for ensureResultsToken.  
2. Dashboard: stop raw roast SQL; optional split keys / entity APIs.  
3. Futures URL from env / shared supabase client SSoT.

---

## Prior audit reconcile

Status relative to live tree on 2026-07-21. Legend: **still true** | **fixed / largely done** | **partial** | **superseded**.

### `docs/refactor-plan.md`

| Item | Status | Notes |
|------|--------|-------|
| T1 views `supabase.from` | **fixed** | `rg supabase.from src/views` → 0; dashboard moved to widget |
| T2 RoastTempChart option extract | **fixed** | Chart ~350L + `lib/chart-option/*` + test |
| T3 plan `api.ts` split | **fixed** | `entities/plan/api/{day-plan,plan-batch,...}` |
| T4 view hooks move | **partial** | weather/futures → shared/api; dashboard → widget; saveRoast → feature; **schedule hook still god** |
| T5 money-path tests | **partial** | plan invalidation test exists; not all integration paths claimed |
| T6a AddMachineModal | **fixed** | modal ~113L + form hooks |
| T6b Cupping god file | **fixed** (shell) | `Cupping.tsx` ~73L split to `ui/*` — **but ui still fetches** (new shape of same problem) |
| T6c NewProfileModal | **fixed** | shell ~69L + form body pieces |
| T6d Login → features/auth | **partial** | `useLogin` exists; Login still ~590L styling wall |

### `docs/production-readiness-audit.md`

| Item | Status | Notes |
|------|--------|-------|
| FSD upper imports rare | **still true** | shared→entities type + entities↔entities remain |
| shared domain commons | **still true** | stock/batch/roast/plan-matrix |
| queries read/write mix | **still true** | plan/cupping largest |
| views bloat | **still true** | schedule, active-roast, orders, machines |
| mutation failure toast | **partial** | MutationCache logs to Sentry only (`main.tsx`) |
| i18n hardcoding | **still true** | Orders EN maps, Login EN, TodayScheduleModal KO, cupping bits |
| Cupping delete `refetch` | **still true** | `Cupping.tsx` |
| Orphan TSV recovery | **still true** (product integrity) | not found as startup scan |
| Sidecar spawn degraded | **still true** (release) | not re-audited deeply |
| Phidget silent fail | **still true** | confirmed in adapter |
| Order create non-atomic | **still true** | compensation delete best-effort |
| Session save vs stock | **fixed** for session path | `save_roast_op`; schedule path separate |

### `docs/inventory-audit.md`

| Item | Status | Notes |
|------|--------|-------|
| C1 session 3-call save | **fixed** (session) | `save_roast_op` |
| C2 double deduct batch vs session | **still true** | client guard one-way + fail-open |
| C3 auto-fulfill on app dispatch | **fixed** (#123) | queried a non-existent `sales_channels`; now `sales_channel_connections` |
| C4 blend deferred trigger | **not re-verified** | leave as prior claim until remote check |
| H1 expected_inbound | **still true** | no consume path |
| H2 blend UX | **still true** | overstock/output checks weak |
| M4 alert await on insert | **still true** | pattern still present |
| M6 window.prompt packaging | **still true** | Orders products tab |

### `docs/machine-connection-hardening.md`

| Item | Status |
|------|--------|
| Phidget silent fail | **still true** |
| Dual registry | **still true** |
| Connect timeout skew | **still true** |
| Unauth sidecar | **still true** |
| Respawn env incomplete | **still true** |

---

## Severity board (architecture/smell only — top items)

| Sev | Domain | Item |
|-----|--------|------|
| P0/high | supabase | channel-connect secrets ownership gap |
| P0/high | supabase / orders | order-dispatch wrong table for auto-fulfill |
| P1 | schedule | useScheduleDayView god + optimistic key skew |
| P1 | inventory | dual deduct references; alert dual RPC; entities↔entities keys |
| P1 | active-roast | dual session clock; fat view + polling SRP |
| P1 | shared/FSD | domain in shared; sidecar type reverse import |
| P1 | machines | Phidget fail-open; dual registry |
| P2 | orders | Orders.tsx split; mutation UX; i18n |
| P2 | cupping | view-layer fetch; refetch after delete |
| P2 | auth | OAuth dual path; plan in auth store |
| P2 | history | ExpandedRow fetch; shared domain filters |
| P3 | pricing / futures | hardcoded URL; fat calculator |

---

## Parallel exploration trail

| Track | Domain |
|-------|--------|
| 1 | active-roast / session |
| 2 | inventory + stock |
| 3 | orders + sales-channel |
| 4 | schedule / plan |
| 5 | history + profiles |
| 6 | sidecar + machines |
| 7 | auth / org / team |
| 8 | shared / FSD |
| 9 | supabase edge + migrations |
| 10 | dashboard + cupping + pricing |

Plus implementer greps: FSD imports, file sizes, refactor-plan spot checks.

---

## Non-goals of this document

- Implementing the fixes above  
- Security pentest beyond architecture-visible issues  
- Exhaustive per-file review  
- Product prioritization beyond architecture impact  
)
