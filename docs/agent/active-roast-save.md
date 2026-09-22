# Active roast save & stock side-effects (agent)

**Audience:** coding agents  
**Date:** 2026-07-21  
**Related:** `docs/inventory-architecture.md`, `docs/superpowers/specs/roast-data-integrity-tracks.md`, `docs/agent/schedule-plan.md`

---

## Purpose

Live roast logging (sidecar temps → log entries → local TSV) and durable save (session row + events + optional green deduct + roasted inbound + R2 curve upload). Wrong order or dual deduct corrupts inventory and history.

---

## Primary trees

| Layer | Paths |
|-------|--------|
| Feature lib/model | `src/features/active-roast/` (`model/useSaveRoast.ts`, `useDeductRoastStock.ts`, `useRoastLog.ts`, `lib/buildRoastStockEvents.ts`, `roastedInbound.ts`, `determine-stock-deduction.ts`, `serialize-roast-events.ts`, `tsv-writer.ts`) |
| View orchestration | `src/views/active-roast/` (`model/useRoastSaveFlow.ts`, `useRoastCompletionFlow.ts`, `useSidecarPolling.ts`, `ActiveRoast.tsx`) |
| Session store | `src/shared/store/roastSession.ts` (handoff; not persisted) |
| Upload | `src/features/upload-roast-profile/` → `src/shared/lib/r2.ts` → EF `get-upload-url` |
| Roast entity | `src/entities/roast/` (`saveOp` / session API) |
| Sidecar client | `src/shared/lib/sidecar.ts` |

---

## Runtime loop (read)

1. Sidecar poll (`useSidecarPolling`) → temperatures
2. Log / auto detection / BBP / phases in feature model+lib
3. Continuous local TSV under app local data (`session_<uuid>.tsv`, optional `bbp_*.tsv`) — durability before network

---

## Save write flow

Orchestrator: `useRoastSaveFlow` → `useSaveRoast` / `saveRoastCore`.

Typical sequence:

1. Resolve workspace (`useActiveWorkspace`) — abort if not ready
2. Optional schedule link: pick `plan_batch` → `toPlanBatchHandoff`
3. **F3 client guard:** if deduct requested and batch id known, `beanStockEventApi.hasRoastDeductionForReference(planBatchId)` → skip deduct + warn
4. Plan gates: monthly/trial batch caps (`src/shared/lib/features/` — `plan-matrix.ts`, `useWriteAccess.ts`)
5. Build session payload + serialized events
6. **Server atomic path:** `roastSessionApi.saveOp` / RPC `save_roast_op` — session + green events + roasted inbound when deduct/inbound flags set (see latest `supabase/migrations/*inventory_flow_hardening*`)
7. Upload curve: local TSV → presigned PUT (`uploadRoastProfile` / BBP) with **owner** user id
8. Coordinator `refreshCachesAfterRoastSave` awaits schedule progress (`syncScheduleAfterRoastSave`), then starts History/dashboard/inventory invalidation (`refreshRoastCachesAfterSave`) without waiting for refetch. `invalidateRoastSessionQueries` still uses `refetchType: 'all'` for update/delete/setOutput. The save modal still waits for curve upload.
9. Parallel profile + BBP uploads (`Promise.allSettled`); local TSV deleted only after that file's DB path confirm. Partial success is kept.
10. Close save modal, then `fetchQuery` today's day batches → `getRemainingDayBatches` (`completed_sessions < batch_count`) → if any, open `PlanBatchContinueModal` with candidates; **Start next** calls `startBatch(handoff)` so bean/profile prefill via existing handoff path. Do not start the next batch before this progress fetch. `listForDateRange` parallelizes independent rule/plan/exception lookups.

Form field semantics (`SaveRoastFormData` in `useSaveRoast.ts`):

- `weightGrams` field is **green input in kg** (name is historical — do not treat as grams without conversion)
- `outputWeightKg` measured roasted output; missing → estimated bulk inbound (`is_estimate`)
- `deductStock` → server-side green roast events when allowed
- Connected machine is snapshotted onto `roast_sessions` (`machine_id` TEXT + name/brand/protocol/`roaster_key`). Local `fc_machines` ids are not a FK. Profile-from-session copies the same columns.

---

## Stock side-effects

| Effect | Mechanism | reference_id |
|--------|-----------|--------------|
| Green − | `roast` events / `insert_stock_events_batch` / inside `save_roast_op` | session id (or batch complete path uses plan_batch id) |
| Bulk + | `upsert_roasted_inbound` | session id (one inbound; upsert for measured correction) |
| History remeasure | History `OutputWeightEditor` | same upsert |

Blends: `buildRoastStockEvents` expands components before batch insert.

---

## R2 curve invariants

- Keys: `profiles/{ownerUserId}/{sessionId}.tsv` and `.bbp.tsv` (`supabase/functions/_shared/r2.ts`)
- Client never holds R2 credentials — only presigned URLs from `get-upload-url` / `get-download-url`
- `kind` must be `profile` \| `bbp` only — wrong kind can overwrite the main profile key
- Cross-user upload requires `has_workspace_access` for `ownerUserId`
- Presign TTL 300s

---

## Agent invariants

1. Do not save roast by inserting `roast_sessions` alone without the documented save op / event serialization.
2. Do not dual-deduct schedule complete + session save for the same green.
3. Always pass workspace owner id into save/upload, not only auth id.
4. Keep local TSV write path; network is secondary durability.
5. Feature→feature import is forbidden: view composes `useSaveRoast` + `useUploadRoastProfile` (injection via `SyncRoastCurve`).
6. After save, invalidate inventory + roast keys; do not invent `refetch()`.
