# Agent documentation gap inventory

**Date:** 2026-07-21  
**Audience:** coding agents  
**Scope:** major product domains vs existing docs language/coverage.

`docs/` is mostly gitignored; only a small allowlist is tracked (see `git ls-files docs/`). Agent-facing English docs live under `docs/agent/` (force-tracked) plus `supabase/AGENTS.md` and rewritten tracked SSoTs.

---

## Domain coverage matrix

| # | Domain | Primary trees | Prior docs | Lang | Agent gap | Action this pass |
|---|--------|---------------|------------|------|-----------|------------------|
| 1 | active-roast | `src/features/active-roast/`, `src/views/active-roast/`, `src/features/active-roast/model/batch.ts` | `active-roast-assessment.md`, integrity specs | KO / mixed EN | **HIGH** — save/deduct/R2 split | **Wrote** `docs/agent/active-roast-save.md` |
| 2 | inventory / stock | `src/entities/*-stock-event/`, package/blend/adjust features, ledger RPCs | `inventory-architecture.md` (tracked) | KO body | **HIGH** — ledger SSoT Korean | **Rewrote** `docs/inventory-architecture.md` EN; index `docs/agent/inventory-ledger.md` |
| 3 | orders / sales-channel | `src/entities/order*`, `sales-channel`, fulfill/dispatch/cancel, EFs | `sales-channel-integration.md`, `order-status-sync.md` | KO only | **HIGH** — secrets + stock | **Wrote** `docs/agent/sales-channels-orders.md` |
| 4 | schedule / plan | `src/entities/plan/`, `src/views/schedule/` | none dedicated | — | **HIGH** — recurrence + batch stock | **Wrote** `docs/agent/schedule-plan.md` |
| 5 | history / profiles | `src/views/history/`, `entities/roast*`, `upload-roast-profile` | integrity EN + history plans | mixed | MED | Deferred (covered partially by active-roast + inventory) |
| 6 | sidecar / machines | `src-tauri/sidecar/`, `entities/machine`, `shared/lib/sidecar.ts` | `sidecar-api.md` EN | EN + KO registry | MED | Deferred (`sidecar-api.md` sufficient for HTTP) |
| 7 | auth / org | `features/auth`, `entities/organization`, `features/team-invite`, workspace store | `team-workspaces.md` stale KO | KO | **HIGH** — write identity | **Wrote** `docs/agent/workspace-auth.md` |
| 8 | supabase edge + migrations | `supabase/functions/`, `supabase/migrations/` | scattered KO | KO | **HIGH** — secrets / writers | **Wrote** `supabase/AGENTS.md` |
| 9 | shared / FSD | `src/shared/`, FSD layers | `AGENTS.md` EN, `data-fetching.md` KO | EN rules / KO fetch | MED fetch | **Wrote** `docs/agent/data-fetching.md` |

≥8 domains surveyed. High-priority gaps selected for write: inventory, orders/channels, schedule, workspace, edge, active-roast save, data-fetching.

---

## Explicit non-deliverables (this pass)

- Full translation of Korean audits (`inventory-audit.md`, `order-dispatch-bugfix.md`, production readiness, pricing GTM).
- Sidecar dual-registry English rewrite (`registry-and-connection.md`).
- Cupping deep dive Englishization.
- Exhaustive per-migration changelog.
- User-facing product / marketing docs.

---

## Ranking rationale

Agent impact order: wrong ledger write > wrong workspace identity > channel secrets > schedule stock double-deduct > roast save TX > fetch invalidation polish > sidecar polish (already EN API).
