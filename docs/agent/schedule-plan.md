# Schedule / plan writes (agent)

**Audience:** coding agents  
**Date:** 2026-07-21

---

## Purpose

Day-based roast planning: `day_plans` + `roast_plan_batches` (+ recurrence rules). Completing a batch may deduct green stock. Starting a batch hands off into Active Roast.

---

## Primary trees

| Layer | Paths |
|-------|--------|
| Entity API | `src/entities/plan/api/day-plan.ts`, `day-plan-range.ts`, `plan-batch.ts`, `recurrence-rule.ts`, `materialize.ts`, `list-for-date-range.ts` |
| Queries | `src/entities/plan/queries.ts` |
| View | `src/views/schedule/` (`Schedule.tsx`, `ScheduleDayView.tsx`, `hooks/useScheduleDayView.ts`, `WeekView.tsx`, `MonthView.tsx`) |
| Widgets | `src/widgets/add-batch-modal/`, `complete-batch-modal/`, `recurring-edit-scope-modal/`, `today-schedule-modal/` |
| Shared math | `src/shared/lib/batch-stock.ts`, `src/shared/lib/stock-calc.ts`, `src/shared/lib/rrule.ts` |
| Session handoff | `src/shared/store/roastSession.ts` (`planBatchHandoff`) |
| RLS | `supabase/migrations/20260722000000_plan_tables_rls.sql` (+ grant migrations) |

Key roots: `planQueryRoots` in `src/shared/lib/query-keys.ts`.

---

## Data model (mental)

- **day_plan**: one row per owner per calendar date (get-or-create pattern).
- **roast_plan_batches**: concrete (or exception) rows under a plan; progress = count of linked `roast_sessions`.
- **recurrence_rules**: RRULE masters; virtual occurrences expand client-side for ranges.
- Editing a **single occurrence** of a recurring series does **not** update the master in place — it **materializes an exception row** (`exception_type: 'modified'`).

See `planBatchApi.updateSingle` and `materializePlanBatch` in `src/entities/plan/api/`.

---

## Write flows

### Create / edit one-off batch

1. Ensure day plan for date (`dayPlanApi.getOrCreate`)
2. `planBatchApi.create` or `updateSingle` without recurrence meta → direct UPDATE

### Edit single occurrence of recurring batch

1. Prefer `materializePlanBatch` / `updateSingle` with `recurrenceRuleId` + `originalDate`
2. Insert exception row with full snapshot fields — **do not** patch the virtual id as if it were a real PK

### Edit series

Use recurrence-rule merge APIs (`recurrenceRuleApi` / `mergeRecurrenceRuleMaster`) + scope modal (`recurring-edit-scope-modal`). Series edits are not the same code path as one-off UPDATE.

### Complete batch (schedule UI)

`useScheduleDayView` → complete modal:

1. Optional green deduct: `batchGreenNeededGramsFromBatch(batch)` = remaining sessions × size (`src/shared/lib/batch-stock.ts`)
2. `useDeductRoastStock` with **`reference_id = plan_batch.id`**
3. Status transition to done
4. If server returns `roast_already_deducted`, still allow complete (session path already took stock)

### Handoff to Active Roast

Set `planBatchHandoff` on `useRoastSessionStore`. Save path in Active Roast may deduct with **session** ref — coordinate with F3 (see inventory + active-roast-save docs).

---

## Stock coupling invariants

1. Complete-batch green ref = **`plan_batch.id`**. Session save ref = **session id**. Never invent a third ref scheme.
2. Deduction grams for complete-batch use **remaining** sessions only (`batch_count - completed_sessions`), not full `batch_count` if some sessions already roasted.
3. Reserved green stock for UI uses the same remaining-session math (see inventory architecture).
4. Plan/trial gates: writes may be blocked by plan readonly / monthly batch caps (`src/shared/lib/features/` — `plan-matrix.ts`, `useWriteAccess.ts`) — honor server errors from batch gates.

---

## Agent do / don't

**Do**

- Route all plan CRUD through `src/entities/plan/`
- Invalidate `planQueryRoots` / plan query helpers after writes
- Use `workspaceOwnerId` for every plan query

**Don't**

- UPDATE a recurring virtual occurrence in place
- Double-deduct green by completing a batch and then saving linked roasts without F3/C2 guards
- Put schedule business logic into widgets without entity APIs
- Bypass RLS with service-role from the desktop app
