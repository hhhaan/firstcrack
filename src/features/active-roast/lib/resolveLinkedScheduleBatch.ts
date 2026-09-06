import type { PlanBatch, PlanBatchHandoff, PlanBatchWithProgress } from '@shared/types/database.types';
import { toPlanBatchHandoff } from './toPlanBatchHandoff';

export type MaterializePlanBatch = (
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
) => Promise<PlanBatch>;

/** Virtual recurrence instances use `{ruleId}:{yyyy-MM-dd}` — not a uuid. */
export const isVirtualPlanBatchId = (id: string): boolean => id.includes(':');

/**
 * Manual schedule-link from the save modal: materialize a virtual recurring
 * instance before `save_roast_op` casts plan_batch_id to uuid.
 */
export async function resolveLinkedScheduleBatch(
    row: PlanBatchWithProgress,
    userId: string,
    materialize: MaterializePlanBatch,
): Promise<PlanBatchHandoff> {
    if (!row.recurrence_rule_id || !isVirtualPlanBatchId(row.id) || !row.scheduled_date) {
        return toPlanBatchHandoff(row);
    }
    const real = await materialize(
        userId,
        row.recurrence_rule_id,
        row.scheduled_date,
        row.original_date ?? row.scheduled_date,
        {
            bean_name: row.bean_name,
            batch_size_kg: Number(row.batch_size_kg),
            target_roasted_kg: Number(row.target_roasted_kg),
            machine_id: row.machine_id,
            bean_id: row.bean_id,
            blend_id: row.blend_id ?? null,
            roast_profile_id: row.roast_profile_id,
            notes: row.notes ?? undefined,
            green_lot: row.green_lot ?? undefined,
            batch_type: row.batch_type,
            yield_pct: row.yield_pct ?? undefined,
            status: row.status ?? 'pending',
        },
    );
    return {
        ...toPlanBatchHandoff(row),
        planBatchId: real.id,
        planId: real.plan_id,
    };
}
