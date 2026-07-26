-- #116: recurring-batch exception rows had no uniqueness on (recurrence_rule_id,
-- original_date). materializePlanBatch inserted unconditionally, so a double-click /
-- concurrent tab / retry could create several exception rows for the same occurrence;
-- the client merge (exceptions.find by original_date) then resolved non-deterministically
-- and complete/deduct reference_ids could point at different batch ids.
--
-- 1. Deduplicate existing rows: keep exactly one row per (recurrence_rule_id,
--    original_date). Preference: a row referenced by roast_sessions.plan_batch_id or by
--    a green-ledger deduct (bean_stock_events.reference_id) > latest updated_at,
--    id as the final deterministic tie-break. roast_sessions rows pointing at a
--    deleted duplicate are re-pointed to the surviving row first (plan_batch_id is a
--    real FK; this also keeps progress counts). bean_stock_events.reference_id is a
--    plain uuid (no FK) and stays untouched as historical ledger fact.
-- 2. Partial unique index so the DB enforces this from now on. The client
--    (materialize.ts) inserts and converges on 23505 — PostgREST upsert cannot use a
--    partial unique index as arbiter, hence no ON CONFLICT there.
--
-- Index-only migration: no schema type change (SKIP_TYPES_GEN territory).

-- ── 1. Deduplicate ──────────────────────────────────────────────────────────
-- Sequential statements (temp table, dropped on commit) so the roast_sessions
-- repoint is fully applied before the DELETE fires any FK action.

CREATE TEMP TABLE _plan_batch_dup_losers ON COMMIT DROP AS
WITH ranked AS (
    SELECT
        b.id,
        FIRST_VALUE(b.id) OVER w AS keeper_id,
        ROW_NUMBER() OVER w AS rn
    FROM public.roast_plan_batches b
    WHERE b.recurrence_rule_id IS NOT NULL
      AND b.original_date IS NOT NULL
    WINDOW w AS (
        PARTITION BY b.recurrence_rule_id, b.original_date
        ORDER BY
            (EXISTS (SELECT 1 FROM public.roast_sessions s WHERE s.plan_batch_id = b.id)
             OR EXISTS (SELECT 1 FROM public.bean_stock_events e WHERE e.reference_id = b.id)) DESC,
            b.updated_at DESC,
            b.id
    )
)
SELECT id, keeper_id FROM ranked WHERE rn > 1;

-- trg_readonly_write_block (20260724000002) fires BEFORE UPDATE on roast_sessions and
-- would abort this maintenance repoint for read_only-plan owners — bypass it for this
-- statement only (DELETE below is not gated; the trigger is INSERT/UPDATE only).
ALTER TABLE public.roast_sessions DISABLE TRIGGER trg_readonly_write_block;

UPDATE public.roast_sessions s
SET plan_batch_id = l.keeper_id
FROM _plan_batch_dup_losers l
WHERE s.plan_batch_id = l.id;

ALTER TABLE public.roast_sessions ENABLE TRIGGER trg_readonly_write_block;

DELETE FROM public.roast_plan_batches b
USING _plan_batch_dup_losers l
WHERE b.id = l.id;

-- ── 2. Enforce uniqueness ───────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_batch_rule_original
    ON public.roast_plan_batches (recurrence_rule_id, original_date)
    WHERE recurrence_rule_id IS NOT NULL AND original_date IS NOT NULL;
