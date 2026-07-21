# Data fetching conventions (agent)

**Audience:** coding agents  
**Date:** 2026-07-21  
**Related:** root `AGENTS.md` (Fetch / State), `src/shared/lib/query-keys.ts`, `src/main.tsx`

---

## Purpose

Desktop app uses React Query with **no background refetch**. UI freshness comes only from explicit invalidation (or optimistic updates). Silent empty screens are avoided via error boundaries.

---

## Primary paths

| Concern | Path |
|---------|------|
| QueryClient defaults | `src/main.tsx` |
| Axios singleton | `src/shared/lib/axios.ts` |
| Supabase client | `src/shared/lib/supabase.ts` |
| Cross-slice key roots | `src/shared/lib/query-keys.ts` |
| View error isolation | `src/shared/ui/ErrorBoundary.tsx` (used from `src/App.tsx`) |
| Entity reads | `src/entities/<slice>/queries.ts` |
| Entity writes / raw IO | `src/entities/<slice>/api.ts` |
| Feature mutations | `src/features/<action>/` hooks |

FSD layout: `api.ts` (raw) → `queries.ts` (reads) → `useX` (writes). **No `useEffect` fetch.**

---

## Global QueryClient invariants

Typical defaults (confirm in `src/main.tsx`):

- `staleTime: Infinity` — successful data is never auto-stale
- `gcTime: Infinity` — keep caches across tab switches
- `refetchOnWindowFocus: false`, `refetchOnReconnect: false`
- Retry: skip 4xx; limited retries for 5xx/network

**Why:** background refetch hurts desktop UX. Mutations **must** call `invalidateQueries` for every affected root. `refetch()` after mutation is forbidden by project rules.

---

## Key factories

Entity factories compose from shared roots so partial invalidation stays consistent.

```ts
// src/shared/lib/query-keys.ts (illustrative)
inventoryQueryRoots.beanStockSummaries  // ['bean-stock-summaries']
inventoryQueryRoots.roastedStock
inventoryQueryRoots.productStock
planQueryRoots.day | batches | rangeBatches | ...
orderKeys.all(userId)
orderKeys.requirements(userId)
dashboardKeys.all(userId)
```

Rules:

- Put only **cross-slice** roots in `query-keys.ts`
- Entity-private keys stay in that entity's `queries.ts`
- Always key by **workspace owner id**, not auth user when in a team workspace

---

## Mutation → invalidation pattern

```ts
onSuccess: (ownerId) => {
  void qc.invalidateQueries({ queryKey: orderKeys.all(ownerId) });
  void qc.invalidateQueries({ queryKey: productStockKeys.byUser(ownerId) });
}
```

Examples of correct multi-root invalidation:

- Fulfill/cancel: `src/features/fulfill-order/`, `src/features/cancel-order/`
- Roast save: `src/features/active-roast/model/useSaveRoast.ts` invalidates roast + inventory roots
- Plan writes: plan entity query helpers / `invalidateScheduledBatchQueries`

When a write touches stock **and** orders/plans, invalidate **all** relevant roots conservatively.

---

## Error boundary architecture

```
QueryClientProvider
  └── ViewErrorBoundary  (per view in App.tsx)
        └── QueryErrorResetBoundary
              └── ErrorBoundary → view tree
```

- One view failure must not take down sidebar or other views
- "Retry" resets the query error state then remounts; with `staleTime: Infinity` there is no silent auto-recovery

---

## Exceptions to infinite staleTime

Override per query only when server drift is user-visible before the next mutation (e.g. weather, coffee futures). Prefer documented TTLs next to the query.

---

## Agent invariants

1. Never introduce `useEffect` + axios/supabase fetch in views.
2. Never call `refetch()` as the primary refresh after mutation — invalidate keys.
3. Never hardcode string query keys that bypass factories/roots.
4. Gate writes on `useActiveWorkspace().isWorkspaceReady` so empty `workspaceOwnerId` does not hit the wrong tenant.
5. Stock reads: prefer entity helpers / ensure* cache-first helpers over inventing parallel aggregations.
