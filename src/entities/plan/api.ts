import { supabase } from '@shared/lib/supabase';
import type {
    DayPlan,
    PlanBatch,
    PlanBatchInsert,
    PlanBatchUpdate,
    PlanBatchWithProgress,
    RecurrenceRule,
    RecurrenceRuleInsert,
} from '@shared/types/database.types';
import { format } from 'date-fns';

// ── Recurrence Rules ─────────────────────────────────────────────────────────

/** Master fields stored on recurrence_rules (propagated on scope edits). */
export type RecurrenceRuleMasterPatch = {
    rrule?: string;
    dtstart?: string;
    machine_id?: string | null;
    roast_profile_id?: string | null;
    bean_id?: string | null;
    blend_id?: string | null;
    bean_name?: string;
    green_lot?: string;
    batch_size_kg?: number;
    yield_pct?: number;
    target_roasted_kg?: number;
    notes?: string;
    batch_type?: string;
};

const mergeRecurrenceRuleMaster = (
    existing: RecurrenceRule,
    patch: RecurrenceRuleMasterPatch,
): Omit<RecurrenceRuleInsert, 'user_id' | 'status' | 'until'> => ({
    machine_id: patch.machine_id !== undefined ? patch.machine_id : existing.machine_id,
    roast_profile_id: patch.roast_profile_id !== undefined ? patch.roast_profile_id : existing.roast_profile_id,
    bean_id: patch.bean_id !== undefined ? patch.bean_id : existing.bean_id,
    blend_id: patch.blend_id !== undefined ? patch.blend_id : existing.blend_id,
    bean_name: patch.bean_name ?? existing.bean_name,
    green_lot: patch.green_lot ?? existing.green_lot,
    batch_size_kg: patch.batch_size_kg ?? existing.batch_size_kg,
    yield_pct: patch.yield_pct ?? existing.yield_pct,
    target_roasted_kg: patch.target_roasted_kg ?? existing.target_roasted_kg,
    notes: patch.notes ?? existing.notes,
    batch_type: patch.batch_type ?? existing.batch_type,
    rrule: patch.rrule ?? existing.rrule,
    dtstart: patch.dtstart ?? existing.dtstart,
});

export const recurrenceRuleApi = {
    /** Create a recurrence rule (Master) */
    create: async (rule: RecurrenceRuleInsert): Promise<RecurrenceRule> => {
        const { data, error } = await supabase.from('recurrence_rules').insert(rule).select().single();
        if (error) throw error;
        return data;
    },

    /** Get a single recurrence rule by ID */
    get: async (id: string): Promise<RecurrenceRule | null> => {
        const { data, error } = await supabase.from('recurrence_rules').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
    },

    /** Update a recurrence rule (e.g., change rrule or until) */
    update: async (id: string, patch: Partial<RecurrenceRuleInsert>): Promise<RecurrenceRule> => {
        const { data, error } = await supabase.from('recurrence_rules').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },

    /** List all active recurrence rules for a user */
    listActive: async (userId: string): Promise<RecurrenceRule[]> => {
        const { data, error } = await supabase
            .from('recurrence_rules')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'active')
            .order('created_at');
        if (error) throw error;
        return data ?? [];
    },
};

// ── Day Plan ──────────────────────────────────────────────────────────────────

export const dayPlanApi = {
    getOrCreate: async (userId: string, date: string): Promise<DayPlan> => {
        const { data: existing } = await supabase
            .from('roast_day_plans')
            .select('*')
            .eq('user_id', userId)
            .eq('date', date)
            .maybeSingle();

        if (existing) return existing;

        const { data, error } = await supabase
            .from('roast_day_plans')
            .insert({ user_id: userId, date, notes: '' })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    updateNotes: async (id: string, notes: string): Promise<DayPlan> => {
        const { data, error } = await supabase.from('roast_day_plans').update({ notes }).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },
};

// ── Day Plan Range Summary ────────────────────────────────────────────────────

export type DayPlanBatchItem = {
    id: string;
    bean_name: string;
    status: string;
    order_index: number;
    batch_count: number;
    target_roasted_kg: number;
};

export type DayPlanSummary = {
    date: string;
    plan_id: string;
    pending: number;
    in_progress: number;
    done: number;
    skipped: number;
    batches: DayPlanBatchItem[];
};

export const dayPlanRangeApi = {
    listSummary: async (userId: string, startDate: string, endDate: string): Promise<DayPlanSummary[]> => {
        const batches = await planBatchApi.listForDateRange(userId, startDate, endDate);
        const summaryMap = new Map<string, DayPlanSummary>();

        for (const batch of batches) {
            const date = batch.scheduled_date;
            if (!date) continue;

            if (!summaryMap.has(date)) {
                summaryMap.set(date, {
                    date,
                    plan_id: batch.plan_id,
                    pending: 0,
                    in_progress: 0,
                    done: 0,
                    skipped: 0,
                    batches: [],
                });
            }

            const summary = summaryMap.get(date)!;
            summary.batches.push({
                id: batch.id,
                bean_name: batch.bean_name,
                status: batch.status,
                order_index: batch.order_index,
                batch_count: batch.batch_count,
                target_roasted_kg: batch.target_roasted_kg,
            });

            if (batch.status === 'pending') summary.pending++;
            else if (batch.status === 'in-progress') summary.in_progress++;
            else if (batch.status === 'done') summary.done++;
            else if (batch.status === 'skipped') summary.skipped++;
        }

        return [...summaryMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    },
};

// ── Plan Batches ──────────────────────────────────────────────────────────────

export const planBatchApi = {
    list: async (planId: string): Promise<PlanBatchWithProgress[]> => {
        const [batchesResult, sessionsResult] = await Promise.all([
            supabase.from('roast_plan_batches').select('*').eq('plan_id', planId).order('order_index'),
            supabase.from('roast_sessions').select('plan_batch_id').not('plan_batch_id', 'is', null),
        ]);

        if (batchesResult.error) throw batchesResult.error;
        if (sessionsResult.error) throw sessionsResult.error;

        const countMap = new Map<string, number>();
        for (const s of sessionsResult.data ?? []) {
            if (s.plan_batch_id) {
                countMap.set(s.plan_batch_id, (countMap.get(s.plan_batch_id) ?? 0) + 1);
            }
        }

        return (batchesResult.data ?? []).map((row) => ({
            ...row,
            completed_sessions: countMap.get(row.id) ?? 0,
        }));
    },

    create: async (batch: PlanBatchInsert): Promise<PlanBatch> => {
        const { data, error } = await supabase.from('roast_plan_batches').insert(batch).select().single();
        if (error) throw error;
        return data;
    },

    /**
     * Update a single batch.
     * - If recurrence_rule_id is present: insert an exception row (modified)
     * - If recurrence_rule_id is null: update the existing row directly (one-off batch)
     */
    updateSingle: async (
        id: string,
        patch: PlanBatchUpdate,
        meta?: { recurrenceRuleId?: string; originalDate?: string },
    ): Promise<PlanBatch> => {
        if (meta?.recurrenceRuleId && meta?.originalDate) {
            // Recurring batch → insert exception row (modified)
            const { data, error } = await supabase
                .from('roast_plan_batches')
                .insert({
                    plan_id: patch.plan_id ?? '', // Required — caller must provide
                    recurrence_rule_id: meta.recurrenceRuleId,
                    scheduled_date: patch.scheduled_date ?? meta.originalDate,
                    original_date: meta.originalDate,
                    exception_type: 'modified',
                    bean_name: patch.bean_name ?? '',
                    batch_size_kg: patch.batch_size_kg ?? 0,
                    target_roasted_kg: patch.target_roasted_kg ?? 0,
                    machine_id: patch.machine_id ?? null,
                    bean_id: patch.bean_id ?? null,
                    blend_id: patch.blend_id ?? null,
                    roast_profile_id: patch.roast_profile_id ?? null,
                    batch_type: patch.batch_type ?? 'Single Origin',
                    notes: patch.notes ?? '',
                    yield_pct: patch.yield_pct ?? 0.82,
                    order_index: patch.order_index ?? 0,
                    status: patch.status ?? 'pending',
                    green_lot: patch.green_lot ?? '',
                    batch_count: patch.batch_count ?? 1,
                })
                .select()
                .single();
            if (error) throw error;
            return data;
        }

        // One-off batch → update directly
        const { data, error } = await supabase.from('roast_plan_batches').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },

    move: async (id: string, newPlanId: string): Promise<void> => {
        const { error } = await supabase.from('roast_plan_batches').update({ plan_id: newPlanId }).eq('id', id);
        if (error) throw error;
    },

    /**
     * Delete a single batch.
     * - If recurrence_rule_id is present: insert a cancelled exception row
     * - If recurrence_rule_id is null: delete the row directly (one-off batch)
     */
    deleteSingle: async (
        id: string,
        meta?: { recurrenceRuleId?: string; originalDate?: string; planId?: string },
    ): Promise<void> => {
        if (meta?.recurrenceRuleId && meta?.originalDate) {
            // Recurring batch → insert cancelled exception
            const { error } = await supabase.from('roast_plan_batches').insert({
                plan_id: meta.planId ?? '',
                recurrence_rule_id: meta.recurrenceRuleId,
                scheduled_date: meta.originalDate,
                original_date: meta.originalDate,
                exception_type: 'cancelled',
                bean_name: '__cancelled__',
                batch_size_kg: 0,
                target_roasted_kg: 0,
            });
            if (error) throw error;
            return;
        }

        // One-off batch → delete directly
        const { error } = await supabase.from('roast_plan_batches').delete().eq('id', id);
        if (error) throw error;
    },

    /**
     * Delete all future instances from a given date onward (from_this).
     * Closes the existing recurrence_rules.until to (fromDate - 1).
     */
    deleteFromThis: async (ruleId: string, fromDate: string): Promise<void> => {
        // Set until to the day before fromDate, effectively truncating
        const untilDate = new Date(fromDate);
        untilDate.setDate(untilDate.getDate() - 1);
        const untilStr = format(untilDate, 'yyyy-MM-dd');

        const { error } = await supabase.from('recurrence_rules').update({ until: untilStr }).eq('id', ruleId);
        if (error) throw error;
    },

    /**
     * Delete all instances of a recurring batch (cancels the entire rule).
     */
    deleteAll: async (ruleId: string): Promise<void> => {
        const { error } = await supabase.from('recurrence_rules').update({ status: 'cancelled' }).eq('id', ruleId);
        if (error) throw error;
    },

    /**
     * Update all future instances from a given date onward (from_this).
     * Closes existing rule's until, then creates a new recurrence_rules record
     * with the updated params starting from fromDate.
     */
    updateFromThis: async (
        ruleId: string,
        fromDate: string,
        patch: RecurrenceRuleMasterPatch & { userId: string },
    ): Promise<RecurrenceRule> => {
        const existing = await recurrenceRuleApi.get(ruleId);
        if (!existing) throw new Error(`Recurrence rule not found: ${ruleId}`);

        const untilDate = new Date(fromDate);
        untilDate.setDate(untilDate.getDate() - 1);
        const untilStr = format(untilDate, 'yyyy-MM-dd');

        const { error: closeError } = await supabase
            .from('recurrence_rules')
            .update({ until: untilStr })
            .eq('id', ruleId);
        if (closeError) throw closeError;

        const { userId, ...masterPatch } = patch;
        const merged = mergeRecurrenceRuleMaster(existing, {
            ...masterPatch,
            dtstart: masterPatch.dtstart ?? fromDate,
        });

        const newRule: RecurrenceRuleInsert = {
            ...merged,
            user_id: userId,
            status: 'active',
        };

        const { data, error } = await supabase.from('recurrence_rules').insert(newRule).select().single();
        if (error) throw error;
        return data;
    },

    /**
     * Update all instances of a recurring batch.
     * Updates the recurrence_rules record (rrule + all master fields).
     */
    updateAll: async (ruleId: string, patch: RecurrenceRuleMasterPatch): Promise<RecurrenceRule> => {
        const { data, error } = await supabase
            .from('recurrence_rules')
            .update(patch)
            .eq('id', ruleId)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    reorder: async (planId: string, orderedIds: string[]): Promise<void> => {
        const updates = await Promise.all(
            orderedIds.map((id, index) =>
                supabase.from('roast_plan_batches').update({ order_index: index }).eq('id', id),
            ),
        );
        for (const { error } of updates) {
            if (error) throw error;
        }
        void planId;
    },

    /**
     * Create a single recurring rule (Master).
     * No expanded instances — rendering will compute them via listForDateRange.
     */
    createRecurring: async (
        _baseBatch: Omit<PlanBatchInsert, 'plan_id'>,
        rruleStr: string,
        dtstart: Date,
        userId: string,
    ): Promise<RecurrenceRule> => {
        const rule = await recurrenceRuleApi.create({
            rrule: rruleStr,
            dtstart: format(dtstart, 'yyyy-MM-dd'),
            user_id: userId,
            machine_id: _baseBatch.machine_id,
            bean_id: _baseBatch.bean_id,
            blend_id: _baseBatch.blend_id ?? null,
            bean_name: _baseBatch.bean_name,
            green_lot: _baseBatch.green_lot ?? '',
            batch_size_kg: _baseBatch.batch_size_kg,
            yield_pct: _baseBatch.yield_pct,
            target_roasted_kg: _baseBatch.target_roasted_kg,
            notes: _baseBatch.notes ?? '',
            batch_type: _baseBatch.batch_type ?? '',
            roast_profile_id: _baseBatch.roast_profile_id,
        });
        return rule;
    },

    /**
     * List batches for a date range, merging recurrence rules with exception rows.
     * This is the rendering-time entry point — computes instances on the fly.
     *
     * @returns Array of PlanBatch-like objects (includes recurrence metadata)
     */
    listForDateRange: async (userId: string, startDate: string, endDate: string): Promise<PlanBatchWithProgress[]> => {
        // 1. Get active recurrence rules
        const rules = await recurrenceRuleApi.listActive(userId);

        // 2. Get one-off batches in the range
        const { data: plans, error: plansError } = await supabase
            .from('roast_day_plans')
            .select('id, date')
            .eq('user_id', userId)
            .gte('date', startDate)
            .lte('date', endDate);
        if (plansError) throw plansError;

        const dateToPlanId = new Map((plans ?? []).map((p) => [p.date, p.id]));
        const planIds = (plans ?? []).map((p) => p.id);

        // Get sessions for progress
        const { data: sessions, error: sessionsError } = await supabase
            .from('roast_sessions')
            .select('plan_batch_id')
            .not('plan_batch_id', 'is', null);
        if (sessionsError) throw sessionsError;

        const sessionCountMap = new Map<string, number>();
        for (const s of sessions ?? []) {
            if (s.plan_batch_id) {
                sessionCountMap.set(s.plan_batch_id, (sessionCountMap.get(s.plan_batch_id) ?? 0) + 1);
            }
        }

        // 3. Get exception rows for recurrence rules in the date range
        const { data: exceptions, error: exceptionsError } = await supabase
            .from('roast_plan_batches')
            .select('*')
            .not('recurrence_rule_id', 'is', null)
            .gte('scheduled_date', startDate)
            .lte('scheduled_date', endDate);
        if (exceptionsError) throw exceptionsError;

        // 4. Get one-off batches (no recurrence_rule_id)
        const { data: oneOffBatches, error: oneOffError } = await supabase
            .from('roast_plan_batches')
            .select('*')
            .is('recurrence_rule_id', null)
            .in('plan_id', planIds);
        if (oneOffError) throw oneOffError;

        // Build result from one-off batches
        const result: PlanBatchWithProgress[] = (oneOffBatches ?? []).map((row) => ({
            ...row,
            completed_sessions: sessionCountMap.get(row.id) ?? 0,
        }));

        // 5. For each active recurrence rule, expand and merge with exceptions
        const rangeStart = new Date(startDate + 'T00:00:00');
        const rangeEnd = new Date(endDate + 'T23:59:59');

        // Dynamic import to avoid circular dependency
        const { expandRRuleInRange, mergeRecurrenceExceptions } = await import('@shared/lib/rrule');

        for (const rule of rules) {
            if (rule.status !== 'active') continue;

            // Check if rule is within range
            const ruleStart = new Date(rule.dtstart + 'T00:00:00');
            if (rule.until && new Date(rule.until + 'T23:59:59') < rangeStart) continue;

            // Expand dates in range
            const expandedDates = expandRRuleInRange(
                rule.rrule,
                ruleStart,
                rangeStart,
                rule.until ? new Date(rule.until + 'T23:59:59') : rangeEnd,
            );

            // Filter exceptions for this rule
            const ruleExceptions = (exceptions ?? [])
                .filter((ex) => ex.recurrence_rule_id === rule.id)
                .map((ex) => ({
                    original_date: ex.original_date ?? '',
                    scheduled_date: ex.scheduled_date ?? '',
                    exception_type: ex.exception_type as 'modified' | 'cancelled',
                    batch_size_kg: ex.batch_size_kg,
                    target_roasted_kg: ex.target_roasted_kg,
                    bean_id: ex.bean_id,
                    bean_name: ex.bean_name,
                    machine_id: ex.machine_id,
                    roast_profile_id: ex.roast_profile_id,
                    notes: ex.notes,
                    status: ex.status,
                }));

            // Merge
            const instances = mergeRecurrenceExceptions(expandedDates, ruleExceptions);

            // For each instance, get or create the day plan and produce a batch-like row
            for (const instance of instances) {
                if (instance.exceptionType === 'cancelled') continue;

                if (instance.exceptionType === 'modified' && instance.exception) {
                    // Use exception data
                    const exBatch = exceptions?.find((e) => e.original_date === instance.originalDate);
                    if (exBatch) {
                        result.push({
                            ...exBatch,
                            completed_sessions: sessionCountMap.get(exBatch.id) ?? 0,
                        });
                    }
                } else if (instance.exceptionType === 'normal') {
                    const planId = dateToPlanId.get(instance.date) ?? '';

                    const batchSize = Number(rule.batch_size_kg) || 0;
                    const targetKg = Number(rule.target_roasted_kg) || 0;
                    const batchCount = batchSize > 0 && targetKg > 0 ? Math.ceil(targetKg / batchSize) : 1;

                    result.push({
                        id: `${rule.id}:${instance.originalDate}`,
                        plan_id: planId,
                        bean_name: rule.bean_name,
                        bean_id: rule.bean_id,
                        blend_id: rule.blend_id ?? null,
                        batch_type: rule.batch_type,
                        batch_size_kg: rule.batch_size_kg,
                        target_roasted_kg: rule.target_roasted_kg,
                        batch_count: batchCount,
                        yield_pct: rule.yield_pct,
                        order_index: 0,
                        machine_id: rule.machine_id,
                        roast_profile_id: rule.roast_profile_id,
                        rrule: rule.rrule,
                        recurrence_group_id: null,
                        recurrence_rule_id: rule.id,
                        scheduled_date: instance.date,
                        original_date: instance.originalDate,
                        exception_type: null,
                        notes: rule.notes,
                        green_lot: rule.green_lot,
                        status: 'pending',
                        created_at: rule.created_at,
                        updated_at: rule.updated_at,
                        completed_sessions: 0,
                    });
                }
            }
        }

        return result.sort((a, b) => a.order_index - b.order_index || a.bean_name.localeCompare(b.bean_name));
    },

    /**
     * Materialize a virtual (computed) recurring batch into a real exception row.
     * Creates the day_plan if missing, then inserts a modified exception row.
     * Returns the real PlanBatch row.
     */
    materialize: async (
        userId: string,
        ruleId: string,
        scheduledDate: string,
        originalDate: string,
        patch: {
            status?: string;
            machine_id?: string | null;
            bean_id?: string | null;
            blend_id?: string | null;
            bean_name?: string;
            roast_profile_id?: string | null;
            batch_size_kg?: number;
            target_roasted_kg?: number;
            yield_pct?: number;
            notes?: string;
            green_lot?: string;
            batch_type?: string;
        },
    ): Promise<PlanBatch> => {
        const plan = await dayPlanApi.getOrCreate(userId, scheduledDate);

        const { data, error } = await supabase
            .from('roast_plan_batches')
            .insert({
                plan_id: plan.id,
                recurrence_rule_id: ruleId,
                scheduled_date: scheduledDate,
                original_date: originalDate,
                exception_type: 'modified',
                bean_name: patch.bean_name ?? '',
                batch_size_kg: patch.batch_size_kg ?? 0,
                target_roasted_kg: patch.target_roasted_kg ?? 0,
                machine_id: patch.machine_id ?? null,
                bean_id: patch.bean_id ?? null,
                blend_id: patch.blend_id ?? null,
                roast_profile_id: patch.roast_profile_id ?? null,
                batch_type: patch.batch_type ?? 'Single Origin',
                notes: patch.notes ?? '',
                yield_pct: patch.yield_pct ?? 0.82,
                order_index: 0,
                status: patch.status ?? 'pending',
                green_lot: patch.green_lot ?? '',
                batch_count: 1,
            })
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
