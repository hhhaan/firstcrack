import type { FeatureKey } from './keys';
import { planHasFeature } from './plan-matrix';

export type FeatureContext = {
    plan: string;
    /** Optional per-user force on/off (profile_feature_flags later). */
    profileOverrides?: ReadonlyMap<string, boolean>;
    countryCode?: string | null;
};

/**
 * Single branching point for feature access.
 * Call sites must use this (or useFeature) — no ad-hoc plan checks.
 */
export function resolveFeature(key: FeatureKey, ctx: FeatureContext): boolean {
    if (ctx.profileOverrides?.has(key)) {
        return Boolean(ctx.profileOverrides.get(key));
    }

    // later: integration.* → country_feature_flags AND plan
    return planHasFeature(ctx.plan, key);
}
