import { supabase } from '@shared/lib/supabase';
import type {
    PlanBatch,
    PlanBatchInsert,
    PlanBatchUpdate,
    PlanBatchWithProgress,
    RecurrenceRule,
    RecurrenceRuleInsert,
} from '@shared/types/database.types';
import { format } from 'date-fns';
import { listForDateRange } from './list-for-date-range';
import { materializePlanBatch } from './materialize';
import { mergeRecurrenceRuleMaster, type RecurrenceRuleMasterPatch, recurrenceRuleApi } from './recurrence-rule';

export const planBatchApi = {
    list: async (planId: string): Promise<PlanBatchWithProgress[]> => {
        const batchesResult = await supabase
            .from('roast_plan_batches')
            .select('*')
            .eq('plan_id', planId)
            .order('order_index');
        if (batchesResult.error) throw batchesResult.error;

        const batches = batchesResult.data ?? [];
        const batchIds = batches.map((b) => b.id);
        const countMap = new Map<string, number>();

        if (batchIds.length > 0) {
            const sessionsResult = await supabase
                .from('roast_sessions')
                .select('plan_batch_id')
                .in('plan_batch_id', batchIds);
            if (sessionsResult.error) throw sessionsResult.error;
            for (const s of sessionsResult.data ?? []) {
                if (s.plan_batch_id) {
                    countMap.set(s.plan_batch_id, (countMap.get(s.plan_batch_id) ?? 0) + 1);
                }
            }
        }

        return batches.map((row) => ({
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
            // Recurring batch → insert exception row (modified).
            // (rule, original_date) is unique — on 23505 converge by UPDATE
            // (same pattern as materializePlanBatch / deleteSingle).
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
                })
                .select()
                .single();
            if (!error) return data;
            if (error.code !== '23505') throw error;

            const definedPatch = Object.fromEntries(
                Object.entries(patch).filter(([k, v]) => k !== 'id' && v !== undefined),
            );
            const { data: existing, error: updateError } = await supabase
                .from('roast_plan_batches')
                .update({
                    ...definedPatch,
                    scheduled_date: patch.scheduled_date ?? meta.originalDate,
                    exception_type: 'modified',
                })
                .eq('recurrence_rule_id', meta.recurrenceRuleId)
                .eq('original_date', meta.originalDate)
                .select()
                .single();
            if (updateError) throw updateError;
            return existing;
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
     *
     * (rule, original_date) is unique (partial index uq_plan_batch_rule_original).
     * PostgREST cannot upsert on that arbiter — on 23505 converge by updating the
     * existing exception row to cancelled (same pattern as materializePlanBatch).
     */
    deleteSingle: async (
        id: string,
        meta?: { recurrenceRuleId?: string; originalDate?: string; planId?: string },
    ): Promise<void> => {
        if (meta?.recurrenceRuleId && meta?.originalDate) {
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
            if (!error) return;
            if (error.code !== '23505') throw error;

            const { error: updateError } = await supabase
                .from('roast_plan_batches')
                .update({
                    exception_type: 'cancelled',
                    bean_name: '__cancelled__',
                    ...(meta.planId ? { plan_id: meta.planId } : {}),
                })
                .eq('recurrence_rule_id', meta.recurrenceRuleId)
                .eq('original_date', meta.originalDate);
            if (updateError) throw updateError;
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
            // index + 1: order_index 0 is pinned for recurring instances (listForDateRange)
            orderedIds.map((id, index) =>
                supabase
                    .from('roast_plan_batches')
                    .update({ order_index: index + 1 })
                    .eq('id', id),
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

    listForDateRange,
    materialize: materializePlanBatch,
};
