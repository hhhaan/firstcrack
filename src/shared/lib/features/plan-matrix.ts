import { FEATURE, type FeatureKey } from './keys';

/** Current auth plan strings (`profiles.plan`). Later: trial | pro | pro_plus | enterprise. */
const PAID_PLANS = new Set(['pro', 'team', 'pro_plus', 'enterprise']);

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
