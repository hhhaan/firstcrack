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
| Batch model | `src/features/active-roast/model/status.ts` + `batch.ts` (prepared, running and latest completed batch; not persisted) |
| Upload | `src/features/upload-roast-profile/` → `src/shared/lib/r2.ts` → EF `get-upload-url` |
| Roast entity | `src/entities/roast/` (`saveOp` / session API) |
| Sidecar client | `src/shared/lib/sidecar.ts` |

---

## Batch ownership and transitions

`useRoastingStore` owns prepared selection/handoff, the running session and selection, and one latest completed batch. Charge copies preparation into the running batch. Defaults and future handoffs only update preparation; an approved reference change updates the running reference and next preparation together. The existing form-prefill values also live in this model.

An explicit source correction updates the active batch without replacing its session, number, curve or next preparation. The `batchTitleSource` setting selects the profile name or the bean/blend name for automatic titles; existing installations default to bean/blend names. Profile-name mode falls back to the selected source when no profile name is available. Edited titles stay unchanged. Profile names belong to the prepared/running selection and are frozen with completed snapshots. Changing the source detaches the active schedule handoff so saving cannot restore the plan's original bean or blend. Completed snapshots remain unchanged.

While reviewing a saved snapshot, the header title is plain text and its bean/blend selector is hidden. Snapshot title/source edits are unavailable; these controls never change the saved title/source, next preparation or device-local default bean. Running-batch title editing and the separate History metadata editor retain their existing behavior.

Snapshot event buttons open the existing log time/temperature editor for missing Yellow/FC marks and custom events. Submission uses the same `useReviewCurveEdit` record RPC as chart edits, with duplicate/order checks. FC dual mode adds Rolling after Start; it does not toggle existing marks off. Drop and End stay locked, and adding an event never writes the live log, next preparation or machine controls.

Review saves compare the previous visible log with the edited log and apply only the changed fields and explicit deletions to the complete DB events. Rows absent from both visible logs (including BBP and History additions), untouched fields and unknown metadata stay unchanged. Editing a field changed elsewhere is rejected as a conflict. The RPC still receives a complete events array with its existing compare-and-swap guard. Heater overrides are rebuilt from the merged record, not the partial visible log. Queued edits retain explicit intent and merge against the current cached record after the preceding request settles. Drafts and late completions are scoped to the review session, owner, and workspace readiness; the captured snapshot log stays unchanged.

`useRoastProfiles` fetches and caches all workspace counters alongside the profile list via `get_roast_batch_counters`. Live titles display the cached counter + 1; changing profiles only reads this cache. Successful saves invalidate it. Edited title text stays unchanged while its numeric suffix follows the current profile and numbering preference. The device setting `totalBatchPrefix` formats the workspace-wide mark as `<prefix> #<number>`. A blank value, and any save that omits the prefix, uses `PR`. Pending checkpoints keep the prefix from the save that created them. History number labels follow the current device prefix and do not rewrite stored titles. The live title editor edits only the text, excluding the preview suffix. Preview numbers are display-only and never enter session identity or pending checkpoints. No number is reserved at Charge, profile changes, Drop, or discard. `save_roast_op` assigns the final workspace-wide and workspace/profile sequences inside its transaction, and its returned title replaces the preview if another device saved first. Independent nullable `roast_sessions.profile_batch_number` and `total_batch_number` survive title edits and hidden title numbering. A missing profile has no profile number. Counters start from the existing completed-record counts; existing records themselves keep null numbers. Never backfill from title suffixes (see [batch-number research](roast-batch-numbering-research.md)).

The pending checkpoint preserves form data, the title-numbering preference, and the total-number prefix, not allocated numbers. Both edited and automatic titles receive the requested suffix during the same server save. Live save and recovery share the existing idempotent session UUID; retrying an existing session returns its committed title and numbers. Failed saves roll back the counters, and deleting a saved roast does not recycle its numbers. There is no local number ledger, reservation queue, or delayed checkpoint enrichment. Offline saves remain pending until the database can assign numbers.

History renders its profile as read-only. The update payload excludes `profile_id` and both number fields; a database trigger also rejects changes to completed identities. Existing profile deletion may still clear the reference via its foreign key without changing the saved numbers. History list/detail/compare and PDF read the saved metadata; CSV exports independent numeric columns. Raw curve TSV stays unchanged and is associated through the session UUID.

Drop/End atomically capture summary, owner, selection, charge origin, curve/logs and machine context, then release the running session into Charge wait. Drop additionally retains the cancel snapshot and pre-Drop Replay state. Cancel restores the same session and original Charge clock, merging the complete auto-Drop lookback and timestamped waiting observations/events into the roast. The save snapshot stays clipped at Drop; undo retains the full observed tail. BBP OFF wait events use Charge-relative storage and wait-relative display/edit coordinates. Restored roast TSV writes finish before cleanup of the unchanged BBP revision; next Charge or submission locks cancellation. The view reducer owns modal visibility only, not completed data.

Model actions perform memory updates only. View hooks write the existing v2 pending checkpoint from the completed snapshot before issuing the sidecar reset, and retain summary data if checkpointing fails. Async save and discard apply only to the matching owner/session; screen remounts cannot reinitialize the running selection. Live collection and controller safety remain separate. This is an ownership/error-recovery refactor; subscription performance and a multi-completed-batch queue are separate work.

## Continuous BBP and roast (#1048)

Charge freezes the wait origin, actual Charge time, original samples/events and
already collected auto-Charge lookback onto the running batch. Drop/End copy this
capture into the completed snapshot, together with the existing frozen roast curve,
clock and logs. Next BBP collection or Charge cannot replace that snapshot's capture.
Drop cancel restores the same capture as well as the roast; it does not finalize a new BBP.

The graph projects the captured BBP at negative Charge-relative times. Replay, PID,
phase calculations and the roast TSV remain roast-only. On save/checkpoint the BBP
summary comes from the completed capture; the global finalized summary is only a
compatibility fallback for snapshots without a capture. Optional `bbpCapture` in v2
pending records preserves raw BBP data for retry without changing the pending version.
First-batch preheat stays in memory while waiting (reload starts it afresh). Once
Charge captures it, its curve and events are included in pending saves and BBP uploads
just like the between-batch wait; `recording` controls only live-wait persistence.

Local collection continues before network save. The original in-progress BBP file
is removed only after the owning archive and transferred roast tail have been written,
and never deletes a newly started wait. Save rematerializes the owning capture's BBP
archive before the existing save operation. Split at actual Charge before rounding:
strictly earlier goes to BBP; equality and later observations/events go to the roast.
Single observations and accepted events without samples are retained. The optional
`# bbp_charge_offset_sec` BBP TSV line carries the actual boundary independently of
`bbp_seconds` (observed sample span), preserving gaps without stretching timestamps.
Legacy files and pending records remain readable. DB schema, stock, upload confirmation
and deletion guards stay unchanged.

## Runtime loop (read)

1. Sidecar poll (`useSidecarPolling`) → temperatures
2. Log / auto detection / BBP / phases in feature model+lib
3. Continuous local TSV under app local data (`session_<uuid>.tsv`, optional `bbp_*.tsv`) — durability before network

---

## Screen recovery

`ActiveRoastRuntime` owns polling and the roast clock outside the screen's `ViewErrorBoundary`.
The session store owns the collected curve and event log (including FC unwind state). A screen
error/retry must preserve these and keep TSV collection running. Only the existing batch lifecycle
may clear them; this does not restore a session after an app/process restart.

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

## Batch-number migration verification (2026-10-22)

The historical chain cannot bootstrap an empty database: placeholder migrations omit the original tables, so `20260510200500_enable_rls.sql` fails with `relation public.beans does not exist`. Validate the new migration using `supabase db reset --local` against an isolated pre-change public-schema snapshot. This tests the new migration against that snapshot, not replay of the complete historical chain. The isolated reset and `supabase/tests/roast_batch_numbers.sql` passed authenticated saves, retry identity, counter rollback, immutable metadata, title modes, legacy nulls and stock invariants. `python3 supabase/tests/roast_batch_numbers_concurrency.py <local-db-container>` passed six concurrent distinct saves and six same-UUID retries. Security advisors returned no errors. Public database types were regenerated locally; the new fields match the existing table/save return shapes (the record-update return already aliases the row). Snapshot-only role defaults were omitted and application signup triggers restored for the isolated check. Production migration application stays on the release path.

2026-10-22: On explicit user request, deployed the numbering and counter-read migrations to the hosted project, fetched its two preceding correction migrations, and regenerated the public/GraphQL types. The merged local reset, SQL checks and concurrency checks passed before deployment. Hosted read-only checks confirmed authenticated counter reads, denied anonymous execution and complete counter seeding. Type generation exposed the missing `NOT NULL` constraint on generated `roast_plan_batches.batch_count`; the validated constraint migration was also deployed. Save input now derives from the database Insert type. The hosted security advisor reports one pre-existing `active_subscriptions` security-definer-view issue, outside these migrations.

## Stock side-effects

| Effect | Mechanism | reference_id |
|--------|-----------|--------------|
| Green − | `roast` events / `insert_stock_events_batch` / inside `save_roast_op` | session id (or batch complete path uses plan_batch id) |
| Bulk + | `upsert_roasted_inbound` | session id (one inbound; upsert for measured correction) |
| History remeasure | History `OutputWeightEditor` | same upsert |
| History charge correction | `set_session_charge_weight` | rescales session-owned `roast` events to the new `weight_grams`. Minimum is 0, same as the summary (`null` is not used). 0 does not rewrite those events — a roast ledger row cannot be 0g — and drops the estimated roasted inbound. Batch-level deduct (`reference_id` = plan batch) is left alone. A positive weight's estimated inbound follows the new green weight |

Blends: `buildRoastStockEvents` expands components before batch insert.

### Saved-roast corrections

History sends only the operator's correction: `correct_session_charge_weight`,
`correct_session_output_weight`, or `set_session_roast_level`. Each locks the
current session row and derives roasted inbound in the same transaction. A level
correction preserves measured output and its stock; clearing measured output
restores the estimate from the current charge and level.

The legacy four-argument `set_session_*_weight` RPCs delegate to these operations
and ignore client-derived inbound arguments. Existing installed clients still
perform level and estimate edits separately; only the new level RPC makes that
operation atomic. Deploy the migration before clients call the new RPCs.

Regression SQL: `supabase/tests/saved_roast_corrections.sql` (local database only;
run with `psql -v ON_ERROR_STOP=1`). It rolls back all fixtures and injected failures.

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

- After DB save (including pending TSV uploads), Active Roast review and History read events and Heat set from the same React Query saved record. The completed snapshot retains capture/recovery data and measured curves; saved event edits never mutate its log. Only explicit queued edit intent is local, and rejection exposes the accepted cache again.
- Review projects nonnegative canonical events into the roast-only display, retaining acknowledged Control values. Negative BBP rows stay outside this display and its editors. Callbacks read the current cache; change-only edits preserve complete BBP rows, unseen rows, and unknown fields. Heat set overrides come from canonical `heater_events`; recorded Heater rows remain recorded events.
- Single write path: RPC `update_roast_session_record` (`entities/roast` `useUpdateRoastRecord`, view hook `views/history/hooks/useRoastRecordSave.ts`).
- Compare-and-swap on `events` + `heater_events`; concurrent edit → `PT409`. Key marks change in place (`time_sec`/`temp_c`). A Note may also change `note`, `gas`, `airflow`, and `drum` (string, or omit the key to clear). Unknown rows/fields are rejected if altered.
- History event and Heat set dialogs retain the row they opened against for both draft construction and compare-and-swap. A refreshed row cannot become the expected version of an older draft; cancel and reopen to edit the latest record. Changing sessions unmounts the old dialog, and workspace/write-access gates still apply at submission.
- Rebuilding Heat set after a Heater edit preserves each stored step's trigger and metadata. Match original Heater IDs before edits, deletions or sorting; equal timestamps use original coordinates and stable occurrence order so one step cannot donate its condition to another.
- BBP Note/Heater/Control rows retain negative Charge-relative times; phase marks stay nonnegative. A roast Heat set override preserves BBP Heater log rows.
- Same TX re-derives `drop_temp_celsius`, `duration_seconds` (End only) and summary columns of profiles with `source_session_id` = record.
- Profiles replay only their own `roast_profiles.heater_events` (after any current-batch edit). A missing profile plan disables Replay and leaves the heat target/editor empty; source-record edits and TSV commands never fill it. Directly selected History records still use their own `roast_sessions.heater_events`, or their recorded TSV Heat set when NULL. Clearing a profile plan never restores source-record commands.
- Never re-runs deduct / roasted inbound / save_roast_op. TSV and BBP curves stay as measured. No sidecar command is sent.
