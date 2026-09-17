import { supabase } from '@shared/lib/supabase';
import type { PlanBatch, PlanBatchHandoff, PlanBatchWithProgress, RecurrenceRule } from '@shared/types/database.types';
import { isUuid, parseVirtualPlanBatchId } from '../lib/virtual-plan-batch-id';
import { materializePlanBatch } from './materialize';
import { recurrenceRuleApi } from './recurrence-rule';

export class UnresolvablePlanBatchIdError extends Error {
    readonly code = 'unresolvable_plan_batch_id';
    constructor(message: string) {
        super(message);
        this.name = 'UnresolvablePlanBatchIdError';
    }
}

type MaterializePatch = Parameters<typeof materializePlanBatch>[4];

export type ResolveForRoastDeps = {
    materialize: typeof materializePlanBatch;
    getRule: (id: string) => Promise<RecurrenceRule | null>;
    getBatch: (id: string) => Promise<PlanBatch | null>;
    getDayPlanOwner: (planId: string) => Promise<string | null>;
    countSessions: (batchId: string) => Promise<number>;
};

const isHandoff = (source: PlanBatchWithProgress | PlanBatchHandoff): source is PlanBatchHandoff =>
    'planBatchId' in source && !('completed_sessions' in source);

const patchFromRow = (row: PlanBatchWithProgress): MaterializePatch => ({
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
});

const patchFromRule = (rule: RecurrenceRule, handoff: PlanBatchHandoff): MaterializePatch => ({
    bean_name: handoff.beanName || rule.bean_name,
    batch_size_kg: handoff.batchSizeKg ?? Number(rule.batch_size_kg),
    target_roasted_kg: Number(rule.target_roasted_kg),
    machine_id: rule.machine_id,
    bean_id: handoff.beanId ?? rule.bean_id,
    blend_id: handoff.blendId ?? rule.blend_id ?? null,
    roast_profile_id: handoff.profileId ?? rule.roast_profile_id,
    notes: rule.notes ?? undefined,
    green_lot: rule.green_lot ?? undefined,
    batch_type: rule.batch_type,
    yield_pct: rule.yield_pct ?? undefined,
    status: 'pending',
});

const assertRuleOwner = (ownerId: string, rule: RecurrenceRule): void => {
    if (rule.user_id !== ownerId) {
        throw new UnresolvablePlanBatchIdError('plan batch owner mismatch');
    }
    if (rule.status === 'cancelled') {
        throw new UnresolvablePlanBatchIdError('plan batch cancelled');
    }
};

const assertBatchUsable = (ownerId: string, batch: PlanBatch, planOwner: string | null): void => {
    if (planOwner !== ownerId) {
        throw new UnresolvablePlanBatchIdError('plan batch owner mismatch');
    }
    if (batch.exception_type === 'cancelled' || batch.status === 'cancelled') {
        throw new UnresolvablePlanBatchIdError('plan batch cancelled');
    }
};

const withProgress = async (
    batch: PlanBatch,
    countSessions: ResolveForRoastDeps['countSessions'],
): Promise<PlanBatchWithProgress> => ({
    ...batch,
    completed_sessions: await countSessions(batch.id),
});

export const defaultResolveForRoastDeps = (): ResolveForRoastDeps => ({
    materialize: materializePlanBatch,
    getRule: (id) => recurrenceRuleApi.get(id),
    getBatch: async (id) => {
        const { data, error } = await supabase.from('roast_plan_batches').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
    },
    getDayPlanOwner: async (planId) => {
        const { data, error } = await supabase.from('roast_day_plans').select('user_id').eq('id', planId).maybeSingle();
        if (error) throw error;
        return data?.user_id ?? null;
    },
    countSessions: async (batchId) => {
        const { data, error } = await supabase
            .from('roast_sessions')
            .select('plan_batch_id')
            .eq('plan_batch_id', batchId);
        if (error) throw error;
        return data?.length ?? 0;
    },
});

/**
 * Owner-verified latest plan batch with a real UUID.
 * Materializes a canonical virtual occurrence (conflict:'read').
 * No status transitions, stock changes, or user prompts.
 */
export async function resolveForRoast(
    ownerId: string,
    source: PlanBatchWithProgress | PlanBatchHandoff,
    deps: ResolveForRoastDeps = defaultResolveForRoastDeps(),
): Promise<PlanBatchWithProgress> {
    const sourceId = isHandoff(source) ? source.planBatchId : source.id;
    const virtual = parseVirtualPlanBatchId(sourceId);

    if (virtual) {
        if (!isHandoff(source) && source.recurrence_rule_id && source.recurrence_rule_id !== virtual.ruleId) {
            throw new UnresolvablePlanBatchIdError('unresolvable plan batch id');
        }
        const rule = await deps.getRule(virtual.ruleId);
        if (!rule) throw new UnresolvablePlanBatchIdError('plan batch not found');
        assertRuleOwner(ownerId, rule);

        const scheduledDate = !isHandoff(source)
            ? (source.scheduled_date ?? virtual.originalDate)
            : virtual.originalDate;
        const originalDate = !isHandoff(source) ? (source.original_date ?? virtual.originalDate) : virtual.originalDate;
        const patch = isHandoff(source) ? patchFromRule(rule, source) : patchFromRow(source);

        const materialized = await deps.materialize(ownerId, virtual.ruleId, scheduledDate, originalDate, patch, {
            conflict: 'read',
        });
        const owner = await deps.getDayPlanOwner(materialized.plan_id);
        assertBatchUsable(ownerId, materialized, owner);
        return withProgress(materialized, deps.countSessions);
    }

    if (!isUuid(sourceId)) {
        throw new UnresolvablePlanBatchIdError('unresolvable plan batch id');
    }

    const batch = await deps.getBatch(sourceId);
    if (!batch) throw new UnresolvablePlanBatchIdError('plan batch not found');
    const owner = await deps.getDayPlanOwner(batch.plan_id);
    assertBatchUsable(ownerId, batch, owner);
    return withProgress(batch, deps.countSessions);
}
