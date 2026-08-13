# Architecture hotspot audit

**Date:** 2026-08-12  
**Scope:** Frontend FSD hotspots (layer direction, god modules, wrong abstraction). Not a full sidecar/Rust rewrite.  
**Method:** LOC ranking, cross-slice import scan, layer-reverse scan, prior inventory (`fsd-page-first-inventory.md`) delta.

## Severity

| Sev | Meaning |
|-----|---------|
| **P0** | Hard FSD/layer break or reverse dependency that blocks clean ownership |
| **P1** | God module / wrong placement that raises change risk; fix when touching domain |
| **P2** | Style, single-consumer placement, optional splits |

## Fixed this pass (PR `refactor/arch-hotspot-p0`)

| ID | Sev | Finding | Fix |
|----|-----|---------|-----|
| H-01 | P0 | `shared/lib/sidecar.ts` imported protocol types from `@entities/machine` | Protocol DTOs → `@shared/types/sidecar`; entity re-exports; client imports shared |
| H-02 | P0 | `shared/lib/e2e-bridge.ts` imported `@features/active-roast` | Moved to `features/active-roast/lib/e2e-bridge.ts`; `main.tsx` dynamic import updated |
| H-03 | P0 | entities↔entities for cross-cache invalidation (`roast`→stock, `order-dispatch`→product-stock, `bean`→bean-stock) | Invalidate via `inventoryQueryRoots` / `orderKeys` in `@shared/lib/query-keys` only |
| H-04 | P1 | No automated FSD import gate | ESLint `no-restricted-imports` per layer (alias imports; tests excluded) |

## Already resolved (vs older inventory)

| Item | Status |
|------|--------|
| Cross-view: History → `RoastTempChart` | Chart lives in `@features/active-roast/ui` |
| Cross-view: History → `NewProfileModal` | Lives in `@widgets/new-profile-modal` |
| Machines connect poll in view monofile | Extracted `@features/machine-connection` |
| features→features cross-slice | **0** alias violations at scan time |

## Deferred P0/P1 (not safe this pass)

| ID | Sev | Finding | Why deferred | Recommended next PR |
|----|-----|---------|--------------|---------------------|
| H-10 | P1 | `useScheduleDayView.ts` ~632L god hook (create/update/delete/reorder/complete + RRULE + stock + invalidation) | Behavior-dense schedule write path; needs feature scenario hooks + day-level tests | `refactor/schedule-day-actions` (CQ-R1) |
| H-11 | P1 | `ActiveRoast.tsx` ~665L orchestration shell | Live roast session; perf branch already active; high regression cost | Split only after hotpath stabilizes; keep view orchestration thin |
| H-12 | P1 | `useSidecarPolling` still under `views/active-roast` | Coupled to chart pipeline types in same view slice | Move types + hook to `features/active-roast` with type export |
| H-13 | P1 | `entities/cupping/queries.ts` ~542L, `entities/plan/queries.ts` ~525L mega query modules | Large but layer-correct (entity owns server state) | Split by resource file inside entity, not layer move |
| H-14 | P1 | `widgets/dashboard-summary` multi-entity aggregation | Acceptable widget composition; optional entity `dashboard` later | Defer unless dashboard gains writes |
| H-15 | P2 | Single-consumer widgets (`bean-detail`, `complete-batch-modal`, …) | Page-first inventory says optional colocate | Only when editing those pages |
| H-16 | P2 | `roasterRegistry.ts` ~690L dual SSoT with Python | Already gated by `pnpm check:registry` | Do not “abstract”; keep dual sync |
| H-17 | P2 | Relative entity↔entity imports may still bypass alias ESLint rule | Rare; scan clean for `@entities` aliases after H-03 | Add path-based CI script if needed |

## Scan evidence (commands)

```bash
# reverse shared → upper (non-test should be empty after H-01/H-02)
rg "from ['\"]@(entities|features|widgets|views)/" src/shared --glob '*.{ts,tsx}'

# entities → entities / upper (non-test should be empty after H-03)
rg "from ['\"]@(entities|features|widgets|views)/" src/entities --glob '*.{ts,tsx}'

# features → features/widgets/views
rg "from ['\"]@(features|widgets|views)/" src/features --glob '*.{ts,tsx}'

# god files
find src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name 'database.types.ts' -exec wc -l {} + | sort -rn | head -20
```

## Stop / non-goals

- Full rewrite of schedule/active-roast god modules in this PR.
- Sidecar Python architecture rewrite.
- P2 placement cleanup of single-consumer widgets.
- Main-workspace dirty WIP (`machine-control` perf notes) — out of scope; worktree from `origin/main`.
