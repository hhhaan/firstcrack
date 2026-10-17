import { i18n } from '@shared/i18n';
import { expandRRuleInRange, formatDateLocal } from '@shared/lib/rrule';
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
    getException: (ruleId: string, originalDate: string) => Promise<PlanBatch | null>;
    getBatch: (id: string) => Promise<PlanBatch | null>;
    getDayPlanOwner: (planId: string) => Promise<string | null>;
    countSessions: (batchId: string) => Promise<number>;
};

const isHandoff = (source: PlanBatchWithProgress | PlanBatchHandoff): source is PlanBatchHandoff =>
    'planBatchId' in source && !('completed_sessions' in source);

const patchFromRule = (rule: RecurrenceRule): MaterializePatch => ({
    bean_name: rule.bean_name,
    batch_size_kg: Number(rule.batch_size_kg),
    target_roasted_kg: Number(rule.target_roasted_kg),
    machine_id: rule.machine_id,
    bean_id: rule.bean_id,
    blend_id: rule.blend_id,
    roast_profile_id: rule.roast_profile_id,
    notes: rule.notes,
    green_lot: rule.green_lot,
    batch_type: rule.batch_type,
    yield_pct: rule.yield_pct,
    status: 'pending',
});

const assertRuleDate = (ownerId: string, rule: RecurrenceRule, date: string): void => {
    assertRuleOwner(ownerId, rule);
    if (date < rule.dtstart || (rule.until && date > rule.until)) {
        throw new UnresolvablePlanBatchIdError('plan occurrence outside recurrence dates');
    }
};

const assertRuleOwner = (ownerId: string, rule: RecurrenceRule): void => {
    if (rule.user_id !== ownerId) {
        throw new UnresolvablePlanBatchIdError('plan batch owner mismatch');
    }
    if (rule.status !== 'active') {
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
    getException: async (ruleId, originalDate) => {
        const { data, error } = await supabase
            .from('roast_plan_batches')
            .select('*')
            .eq('recurrence_rule_id', ruleId)
            .eq('original_date', originalDate)
            .maybeSingle();
        if (error) throw error;
        return data;
    },
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
        const { count, error } = await supabase
            .from('roast_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('plan_batch_id', batchId);
        if (error) throw error;
        if (count === null) throw new Error('Linked roast session count unavailable');
        return count;
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
        if (
            !isHandoff(source) &&
            (source.recurrence_rule_id !== virtual.ruleId || source.original_date !== virtual.originalDate)
        ) {
            throw new UnresolvablePlanBatchIdError('unresolvable plan batch id');
        }
        const rule = await deps.getRule(virtual.ruleId);
        if (!rule) throw new UnresolvablePlanBatchIdError('plan batch not found');
        assertRuleDate(ownerId, rule, virtual.originalDate);
        let batch = await deps.getException(virtual.ruleId, virtual.originalDate);
        if (!batch) {
            const date = new Date(`${virtual.originalDate}T00:00:00`);
            if (
                !expandRRuleInRange(rule.rrule, new Date(`${rule.dtstart}T00:00:00`), date, date).some(
                    (occurrence) => formatDateLocal(occurrence) === virtual.originalDate,
                )
            ) {
                throw new UnresolvablePlanBatchIdError('invalid plan occurrence');
            }
            batch = await deps.materialize(
                ownerId,
                virtual.ruleId,
                virtual.originalDate,
                virtual.originalDate,
                patchFromRule(rule),
                { conflict: 'read' },
            );
            const latestRule = await deps.getRule(virtual.ruleId);
            if (!latestRule || JSON.stringify(latestRule) !== JSON.stringify(rule)) {
                throw new UnresolvablePlanBatchIdError('plan recurrence changed; retry required');
            }
        }
        assertBatchUsable(ownerId, batch, await deps.getDayPlanOwner(batch.plan_id));
        return withProgress(batch, deps.countSessions);
    }

    if (!isUuid(sourceId)) {
        throw new UnresolvablePlanBatchIdError('unresolvable plan batch id');
    }

    const batch = await deps.getBatch(sourceId);
    if (!batch) throw new UnresolvablePlanBatchIdError('plan batch not found');
    const owner = await deps.getDayPlanOwner(batch.plan_id);
    assertBatchUsable(ownerId, batch, owner);
    if (batch.recurrence_rule_id) {
        const rule = await deps.getRule(batch.recurrence_rule_id);
        if (!rule || !batch.original_date) throw new UnresolvablePlanBatchIdError('plan recurrence not found');
        assertRuleDate(ownerId, rule, batch.original_date);
    }
    return withProgress(batch, deps.countSessions);
}

/** Atomic batch complete: server computes remaining green deduct + status=done (#891). */
export async function completePlanBatch(batchId: string, deductStock: boolean): Promise<PlanBatchWithProgress> {
    const { data, error } = await supabase.rpc('complete_plan_batch', {
        p_batch_id: batchId,
        p_deduct: deductStock,
    });
    if (error) throw error;
    const row = data as PlanBatch;
    return { ...row, completed_sessions: row.batch_count ?? 0 };
}

/** Only change status if the row still has the revision we validated. */
export async function updateRoastStatus(
    batch: PlanBatchWithProgress,
    status: 'in-progress' | 'done',
): Promise<PlanBatchWithProgress> {
    const { data, error } = await supabase
        .from('roast_plan_batches')
        .update({ status })
        .eq('id', batch.id)
        .eq('plan_id', batch.plan_id)
        .or('exception_type.is.null,exception_type.neq.cancelled')
        .eq('updated_at', batch.updated_at)
        .eq('status', batch.status)
        .select()
        .single();
    if (error) throw error;
    return { ...data, completed_sessions: batch.completed_sessions };
}

export async function startForRoast(
    ownerId: string,
    source: PlanBatchWithProgress | PlanBatchHandoff,
): Promise<PlanBatchWithProgress> {
    const batch = await resolveForRoast(ownerId, source);
    if (!batch.bean_id && !batch.blend_id) {
        throw new UnresolvablePlanBatchIdError(i18n.t('schedule.error.sourceRequired'));
    }
    if (batch.status === 'done' || batch.completed_sessions >= batch.batch_count) {
        throw new UnresolvablePlanBatchIdError('plan batch already completed');
    }
    return updateRoastStatus(batch, 'in-progress');
}

/** A committed roast can sync after a series cancellation without resurrecting it. */
export async function syncRoastProgress(ownerId: string, batchId: string): Promise<PlanBatchWithProgress> {
    if (!isUuid(batchId)) throw new UnresolvablePlanBatchIdError('unresolvable plan batch id');
    const deps = defaultResolveForRoastDeps();
    const batch = await deps.getBatch(batchId);
    if (!batch || (await deps.getDayPlanOwner(batch.plan_id)) !== ownerId) {
        throw new UnresolvablePlanBatchIdError('plan batch owner mismatch');
    }
    const latest = await withProgress(batch, deps.countSessions);
    if (
        batch.status !== 'cancelled' &&
        batch.exception_type !== 'cancelled' &&
        batch.status !== 'done' &&
        latest.completed_sessions >= batch.batch_count
    ) {
        if (batch.recurrence_rule_id) {
            const rule = await deps.getRule(batch.recurrence_rule_id);
            if (
                rule &&
                (rule.status !== 'active' || (rule.until && batch.original_date && batch.original_date > rule.until))
            )
                return latest;
        }
        return updateRoastStatus(latest, 'done');
    }
    return latest;
}
