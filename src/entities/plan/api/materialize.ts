import { supabase } from '@shared/lib/supabase';
import type { PlanBatch } from '@shared/types/database.types';
import { dayPlanApi } from './day-plan';

/**
 * Materialize a virtual (computed) recurring batch into a real exception row.
 * Creates the day_plan if missing, then inserts a modified exception row.
 */
export async function materializePlanBatch(
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
    if (error) throw error;
    return data;
}
