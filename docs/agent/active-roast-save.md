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
| Runtime store | `src/features/active-roast/model/status.ts` (`useRoastingStore`; logs, curve, Charge clock, preparation/current selection, completed records and transitions). The in-progress roast is also journaled in `sessionStorage` (`liveRoastDraft.ts`) and rehydrated on same-tab reload |
| Completed slice | `src/features/active-roast/model/completed.ts` (owner/session identity, frozen save context, draft, per-batch lock, modal selection) |
| Next-plan handoff | `src/shared/store/roastSession.ts` (consumed at Charge; not persisted) |
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
8. Coordinator `refreshCachesAfterRoastSave` once (optional schedule progress, then History/dashboard refetch). `saveRoastCore` does not await that refetch.
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

---

## Post-save record edit (History, #623)

Saved events are **not** immutable: History edits key marks (time/temp) and the Heat set plan.

- Single write path: RPC `update_roast_session_record` (`entities/roast` `useUpdateRoastRecord`, view hook `views/history/hooks/useRoastRecordSave.ts`).
- Compare-and-swap on `events` + `heater_events`; concurrent edit → `PT409`. Events change in place only (`time_sec`/`temp_c`); unknown rows/fields are rejected if altered.
- Same TX re-derives `drop_temp_celsius`, `duration_seconds` (End only) and summary columns of profiles with `source_session_id` = record.
- `roast_sessions.heater_events` NULL = recorded TSV Heat set. Replay/heat target precedence: batch > `roast_profiles.heater_events` > source record `heater_events` > TSV (`profileHeaterEvents`).
- Never re-runs deduct / roasted inbound / save_roast_op. TSV and BBP curves stay as measured. No sidecar command is sent.

## Runtime and completed batch ownership (#671)

`useRoastingStore` is the session lifetime source. Screen remounts retain logs,
curve, Charge origin, current selection and completed records. A same-tab
document reload rehydrates the in-progress roast (session id, event log, curve,
Charge origin) from a `sessionStorage` journal before paint, and adopts the
existing TSV instead of rewriting its header. Drop, abort, and reset clear that
journal. A new tab does not see it. The view owns I/O, BBP/PID/Replay effect
composition and chart presentation. One polling lease and a shared second clock
prevent duplicate polling/timers during overlapping mounts.

- Execution phases are `idle`, `preheating`, `standby`, `roasting`. Completion has
  no execution phase. `drop`/`abort` capture the record before releasing the machine
  to next-Charge wait; `cancelDrop`, `reset`, `saveSucceeded`, `discardCompleted`
  enforce the mutation boundary. `startCharge` validates the origin and consumes
  the prepared plan once. A new batch has no plan unless explicitly handed off.
- Completed records use `JSON.stringify([ownerId, sessionId])`. Modal state stores
  this key; summaries, frozen save parameters, form drafts and locks belong to the
  record. B's Drop opens B; the banner opens the active owner's oldest unsaved
  record. Closing preserves it. Success for A updates only A, including after a
  remount or workspace switch. Saving A does not block saving B.
- The existing v2 checkpoint remains the crash/partial-upload retry contract.
  `hydrateCompleted` restores only checkpoint-owned fields; missing legacy fields
  are not filled from the running batch. Submitted retries still use the recovery
  widget and the existing upload checkpoints. No DB or upload protocol changed.
- Drop cancel retains the original Charge origin and ID, including modal wait
  time. Valid wait readings are archived separately even with BBP off, then joined
  to the original curve and TSV. Duplicate/backward/stale readings are skipped;
  disconnect gaps have no synthetic points. Cancel removes the invalid Drop and
  wait BBP. A subsequent Charge, a save lock, success or discard forbids cancel.
  PID/Replay remain stopped. Modal X cancels only when this record is cancelable.
- Reset sends the actual hold choice to `/reset`: `hold` preserves machine heat
  and connection; `zero` is the default safe reset. Failure/reconnect safety stays
  in the sidecar. Runtime servers for separate worktrees must run sequentially.

### #671 validation in the cloud workspace

- `VITE_SUPABASE_URL=https://e2e.supabase.local VITE_SUPABASE_ANON_KEY=e2e-anon-key pnpm verify:all`
  passed: 1,980 frontend tests (one skipped), 494 sidecar tests (three skipped),
  typecheck, Biome, ESLint, Knip, architecture and repository checks. The env
  values are the repository's E2E placeholders; no live database is required.
- Sidecar HTTP smoke tests with the virtual roaster covered hold/zero/default/
  invalid reset modes, next Charge and disconnect/reconnect.
- React Doctor checked the changed files and reported three diagnostics. Manual
  review found the polling effect returns cleanup for both the native listener
  and interval, including a listener resolving after unmount. Its dependency
  warning targets `useEffectEvent` callbacks, which read fresh values without
  resubscribing. The form warning targets resetting an ID-owned form from its
  persisted draft when a summary opens. These diagnostics remain unsuppressed;
  polling cleanup, overlapping mounts and draft retention have regression tests.
- Playwright E2E could not launch because Chromium is absent and the configured
  network policy rejects `cdn.playwright.dev` downloads (HTTP 403). Browser E2E
  remains unverified; do not treat the unit/HTTP checks as a browser run.
