import { useActiveWorkspace } from '@entities/organization';
import { useCompletedMonthSessionCount, useCompletedSessionCount } from '@entities/roast';
import { planMaxBatchesPerMonth, TRIAL_BATCH_CAP, useEffectivePlan } from '@shared/lib/features';

export type BatchQuota = {
    /** Quota is already spent — the next completed roast would be refused by the server. */
    exceeded: boolean;
    /** Trial counts lifetime batches; every other plan counts the current month. */
    isTrial: boolean;
    max: number | null;
};

/** Server exempts trial from the monthly cap (batch_gate_trial.sql) — lifetime cap only. */
function planQuotaShape(plan: string): { isTrial: boolean; max: number | null } {
    const isTrial = plan === 'trial';
    return { isTrial, max: isTrial ? TRIAL_BATCH_CAP : planMaxBatchesPerMonth(plan) };
}

/** Pure so the plan→(cap, exceeded) table is testable without React Query wiring. */
export function computeBatchQuota(params: { plan: string; lifetimeCount?: number; monthCount?: number }): BatchQuota {
    const { isTrial, max } = planQuotaShape(params.plan);
    const used = isTrial ? params.lifetimeCount : params.monthCount;
    return { exceeded: used != null && max != null && used >= max, isTrial, max };
}

/**
 * Pre-roast mirror of the server batch gate (enforce_batch_gate), so the block
 * lands before beans are spent instead of at save time.
 *
 * Counts come from the cached queries — the charge click must not wait on a
 * round trip. An unloaded/failed count reads as "not exceeded"; the save-time
 * check and the DB trigger remain the authority.
 */
export function useBatchQuota(): BatchQuota {
    const plan = useEffectivePlan();
    const { workspaceOwnerId } = useActiveWorkspace();
    const { isTrial, max } = planQuotaShape(plan);
    // Only one count feeds `exceeded` — disable the other query (and skip it entirely for
    // unlimited plans, where no count could ever make `exceeded` true) rather than fetch and discard it.
    const { data: lifetimeCount } = useCompletedSessionCount(isTrial ? workspaceOwnerId : '');
    const { data: monthCount } = useCompletedMonthSessionCount(!isTrial && max != null ? workspaceOwnerId : '');

    return computeBatchQuota({ plan, lifetimeCount, monthCount });
}
