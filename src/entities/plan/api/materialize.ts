import { supabase } from '@shared/lib/supabase';
import type { PlanBatch } from '@shared/types/database.types';
import { dayPlanApi } from './day-plan';

type MaterializePatch = {
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
};

/**
 * Materialize a virtual (computed) recurring batch into a real exception row.
 * Creates the day_plan if missing, then inserts a modified exception row.
 *
 * (rule, original_date) is unique (partial index uq_plan_batch_rule_original), but
 * PostgREST upsert cannot use a partial unique index as arbiter — so on 23505
 * (double-click / concurrent tab / retry) we converge by updating the existing row.
 */
export type MaterializeConflict = 'update' | 'read';

export async function materializePlanBatch(
    userId: string,
    ruleId: string,
    scheduledDate: string,
    originalDate: string,
    patch: MaterializePatch,
    options?: { conflict?: MaterializeConflict },
): Promise<PlanBatch> {
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
        })
        .select()
        .single();
    if (!error) return data;
    if (error.code !== '23505') throw error;

    // Start/Continue/save/recovery pass conflict:'read' so a concurrent materialize
    // does not overwrite the existing exception with a stale snapshot.
    if ((options?.conflict ?? 'update') === 'read') {
        const { data: existing, error: readError } = await supabase
            .from('roast_plan_batches')
            .select()
            .eq('recurrence_rule_id', ruleId)
            .eq('original_date', originalDate)
            .single();
        if (readError) throw readError;
        return existing;
    }

    // The exception row already exists — apply only the caller's explicit fields
    // (plus scheduling context) so a partial patch does not reset the row to defaults.
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const { data: existing, error: updateError } = await supabase
        .from('roast_plan_batches')
        .update({
            ...definedPatch,
            plan_id: plan.id,
            scheduled_date: scheduledDate,
            exception_type: 'modified',
        })
        .eq('recurrence_rule_id', ruleId)
        .eq('original_date', originalDate)
        .select()
        .single();
    if (updateError) throw updateError;
    return existing;
}
