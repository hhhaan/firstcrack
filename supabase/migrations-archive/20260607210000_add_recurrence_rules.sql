-- Create recurrence_rules master table for managing recurring roast batches
-- This replaces the previous approach of expanding RRULE into individual rows
-- 
-- Migration strategy:
-- 1. Create recurrence_rules table (Master)
-- 2. Modify roast_plan_batches to add recurrence_rule_id FK + exception columns
-- 3. Backfill: migrate existing rrule + recurrence_group_id data
-- 4. Legacy columns (rrule, recurrence_group_id) will be dropped later

-- ── 1. Create recurrence_rules master table ──────────────────────────────────

CREATE TABLE public.recurrence_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rrule TEXT NOT NULL,
    dtstart DATE NOT NULL,
    "until" DATE,                                   -- NULL = indefinite
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    machine_id TEXT,
    roast_profile_id UUID REFERENCES public.roast_profiles(id) ON DELETE SET NULL,
    bean_id UUID REFERENCES public.beans(id) ON DELETE SET NULL,
    bean_name TEXT NOT NULL DEFAULT '',
    green_lot TEXT NOT NULL DEFAULT '',
    batch_size_kg NUMERIC NOT NULL DEFAULT 0,
    yield_pct NUMERIC NOT NULL DEFAULT 0,
    target_roasted_kg NUMERIC NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    batch_type TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.recurrence_rules IS 'Master RRULE definitions for recurring roast batches';
COMMENT ON COLUMN public.recurrence_rules.rrule IS 'RFC 5545 RRULE string (e.g. FREQ=WEEKLY;INTERVAL=2)';
COMMENT ON COLUMN public.recurrence_rules.dtstart IS 'Start date for the recurrence';
COMMENT ON COLUMN public.recurrence_rules."until" IS 'End date for the recurrence. NULL = indefinite (active until cancelled)';
COMMENT ON COLUMN public.recurrence_rules.status IS 'active | cancelled';

-- ── 2. Modify roast_plan_batches — add recurrence_rule_id + exception columns ─

ALTER TABLE public.roast_plan_batches
    ADD COLUMN IF NOT EXISTS recurrence_rule_id UUID REFERENCES public.recurrence_rules(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS scheduled_date DATE,
    ADD COLUMN IF NOT EXISTS original_date DATE,
    ADD COLUMN IF NOT EXISTS exception_type TEXT CHECK (exception_type IN ('modified', 'cancelled'));

COMMENT ON COLUMN public.roast_plan_batches.recurrence_rule_id IS 'FK to recurrence_rules. NULL = one-off batch';
COMMENT ON COLUMN public.roast_plan_batches.scheduled_date IS 'The date this batch instance is scheduled for';
COMMENT ON COLUMN public.roast_plan_batches.original_date IS 'Original recurrence date. Used to match exception rows during merge';
COMMENT ON COLUMN public.roast_plan_batches.exception_type IS 'NULL = normal (data from Master), modified = overridden, cancelled = hidden during merge';

-- ── 3. Backfill: migrate existing recurrence data ─────────────────────────────
-- Existing rows with recurrence_group_id represent expanded instances of
-- the same recurrence. We group them by recurrence_group_id + rrule + user_id
-- to reconstruct a recurrence_rules master record, then link back.

DO $$
DECLARE
    rec RECORD;
    new_rule_id UUID;
BEGIN
    FOR rec IN (
        SELECT DISTINCT ON (b.recurrence_group_id)
            b.recurrence_group_id,
            b.rrule,
            b.machine_id,
            b.bean_id,
            b.bean_name,
            b.green_lot,
            b.batch_size_kg,
            b.yield_pct,
            b.target_roasted_kg,
            b.notes,
            b.batch_type,
            b.roast_profile_id,
            p.user_id
        FROM roast_plan_batches b
        JOIN roast_day_plans p ON p.id = b.plan_id
        WHERE b.recurrence_group_id IS NOT NULL
          AND b.rrule IS NOT NULL
        ORDER BY b.recurrence_group_id, p.date ASC
    ) LOOP
        INSERT INTO public.recurrence_rules (
            rrule, dtstart, user_id,
            machine_id, bean_id, bean_name, green_lot,
            batch_size_kg, yield_pct, target_roasted_kg,
            notes, batch_type, roast_profile_id
        )
        VALUES (
            rec.rrule,
            (SELECT MIN(p2.date::DATE) FROM roast_plan_batches b2
             JOIN roast_day_plans p2 ON p2.id = b2.plan_id
             WHERE b2.recurrence_group_id = rec.recurrence_group_id),
            rec.user_id,
            rec.machine_id,
            rec.bean_id,
            rec.bean_name,
            rec.green_lot,
            rec.batch_size_kg,
            rec.yield_pct,
            rec.target_roasted_kg,
            rec.notes,
            rec.batch_type,
            rec.roast_profile_id
        )
        RETURNING id INTO new_rule_id;

        UPDATE roast_plan_batches
        SET recurrence_rule_id = new_rule_id,
            scheduled_date = roast_day_plans.date
        FROM roast_day_plans
        WHERE roast_day_plans.id = roast_plan_batches.plan_id
          AND roast_plan_batches.recurrence_group_id = rec.recurrence_group_id;
    END LOOP;
END $$;

-- ── 4. RLS + Grants ─────────────────────────────────────────────────────────

ALTER TABLE public.recurrence_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can manage own recurrence_rules"
    ON public.recurrence_rules
    FOR ALL
    USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurrence_rules TO authenticated;