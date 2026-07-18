import { FEATURE, type FeatureKey } from './keys';

/** Current auth plan strings (`profiles.plan`). Later: trial | pro | pro_plus | enterprise. */
const PAID_PLANS = new Set(['pro', 'team', 'pro_plus', 'enterprise']);

/** Multi-machine (2+): Pro+ and above. Legacy `team` maps to enterprise-class. */
const MULTI_MACHINE_PLANS = new Set(['pro_plus', 'enterprise', 'team']);

/** E-commerce order integration: enterprise-class only (legacy `team` included). */
const ORDER_INTEGRATION_PLANS = new Set(['enterprise', 'team']);

export function isPaidPlan(plan: string): boolean {
    return PAID_PLANS.has(plan);
}

/** Plan → feature. Only place that encodes “who gets what”. */
export function planHasFeature(plan: string, key: FeatureKey): boolean {
    switch (key) {
        case FEATURE.cupping:
            return isPaidPlan(plan);
        case FEATURE.bbp:
            return isPaidPlan(plan);
        case FEATURE.orderIntegration:
            return ORDER_INTEGRATION_PLANS.has(plan);
        default:
            return false;
    }
}

/**
 * Max registered real machines (Virtual excluded).
 * `null` = unlimited.
 * Below Pro+: 1 machine. Pro+ / enterprise / legacy team: unlimited.
 */
export function planMaxMachines(plan: string): number | null {
    if (MULTI_MACHINE_PLANS.has(plan)) return null;
    return 1;
}

export function canAddMachine(plan: string, realMachineCount: number): boolean {
    const max = planMaxMachines(plan);
    if (max == null) return true;
    return realMachineCount < max;
}

/** Completed roast sessions per calendar month. `null` = unlimited. Pro = 200; Pro+ = unlimited. */
export const PRO_MONTHLY_BATCH_CAP = 200;

export function planMaxBatchesPerMonth(plan: string): number | null {
    if (MULTI_MACHINE_PLANS.has(plan)) return null;
    return PRO_MONTHLY_BATCH_CAP;
}

export function canCompleteBatch(plan: string, completedThisMonth: number): boolean {
    const max = planMaxBatchesPerMonth(plan);
    if (max == null) return true;
    return completedThisMonth < max;
}

export class BatchLimitError extends Error {
    readonly used: number;
    readonly max: number;

    constructor(used: number, max: number) {
        super(`Monthly batch limit reached (${used}/${max}). Upgrade to Pro+ for unlimited batches.`);
        this.name = 'BatchLimitError';
        this.used = used;
        this.max = max;
    }
}
