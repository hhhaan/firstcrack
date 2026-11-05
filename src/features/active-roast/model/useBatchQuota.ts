import { useActiveWorkspace } from '@entities/organization';
import { canStartCharge, planChargeCap, useEffectivePlan, useRoastChargeUsage } from '@shared/lib/features';

export type BatchQuota = {
    /** All slots are used or held — a new Charge needs its own admission. */
    exceeded: boolean;
    /** Trial allowances are cumulative rather than monthly. */
    isTrial: boolean;
    max: number | null;
};

/** Pure so the plan→(cap, exceeded) table is testable without React Query wiring. */
export function computeBatchQuota(params: { plan: string; chargeCount?: number }): BatchQuota {
    const isTrial = params.plan === 'trial' || params.plan === 'trial-event';
    const max = planChargeCap(params.plan);
    const used = params.chargeCount;
    return { exceeded: used != null && !canStartCharge(params.plan, used), isTrial, max };
}

/**
 * Pre-roast mirror of the server batch gate (enforce_batch_gate), so the block
 * lands before beans are spent instead of at save time.
 *
 * Counts come from the cached queries — the charge click must not wait on a
 * round trip. An unloaded count is only a display hint; capped plans also require a
 * server admission before Charge, independently of this cached quota.
 */
export function useBatchQuota(): BatchQuota {
    const plan = useEffectivePlan();
    const { workspaceOwnerId } = useActiveWorkspace();
    const { data: usage } = useRoastChargeUsage(workspaceOwnerId, plan);
    const chargeCount = usage ? usage.used_batches + usage.reserved_batches : undefined;
    return computeBatchQuota({ plan, chargeCount });
}
