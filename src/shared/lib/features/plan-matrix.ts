import { FEATURE, type FeatureKey } from './keys';

/** Current auth plan strings (`profiles.plan`). Later: trial | pro | pro_plus | enterprise. */
const PAID_PLANS = new Set(['pro', 'team', 'pro_plus', 'enterprise']);

/** Multi-machine (2+): Pro+ and above. Legacy `team` maps to enterprise-class. */
const MULTI_MACHINE_PLANS = new Set(['pro_plus', 'enterprise', 'team']);

export function isPaidPlan(plan: string): boolean {
    return PAID_PLANS.has(plan);
}

/** Plan → feature. Only place that encodes “who gets what”. */
export function planHasFeature(plan: string, key: FeatureKey): boolean {
    switch (key) {
        case FEATURE.cupping:
            return isPaidPlan(plan);
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
