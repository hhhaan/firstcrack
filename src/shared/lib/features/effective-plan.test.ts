import { describe, expect, it } from 'vitest';
import { resolveEffectivePlan } from './effective-plan';
import { FEATURE } from './keys';
import { planHasFeature } from './plan-matrix';

describe('resolveEffectivePlan', () => {
    const me = 'user-me';
    const owner = 'owner-ent';

    it('uses personal plan on self workspace', () => {
        expect(
            resolveEffectivePlan({
                personalPlan: 'free',
                authUserId: me,
                activeOwnerId: null,
                ownerPlanById: { [owner]: 'enterprise' },
            }),
        ).toBe('free');
        expect(
            resolveEffectivePlan({
                personalPlan: 'pro',
                authUserId: me,
                activeOwnerId: me,
                ownerPlanById: { [owner]: 'enterprise' },
            }),
        ).toBe('pro');
    });

    it('inherits owner plan on foreign workspace', () => {
        expect(
            resolveEffectivePlan({
                personalPlan: 'free',
                authUserId: me,
                activeOwnerId: owner,
                ownerPlanById: { [owner]: 'enterprise' },
            }),
        ).toBe('enterprise');
    });

    it('denies gated features while foreign owner plan is unknown', () => {
        expect(
            resolveEffectivePlan({
                personalPlan: 'free',
                authUserId: me,
                activeOwnerId: owner,
                ownerPlanById: {},
            }),
        ).toBe('free'); // resolveWorkspaceOwnerId falls back to self when no membership
    });

    it('returns empty when membership known but plan missing', () => {
        // membership present (key exists) but empty plan string
        expect(
            resolveEffectivePlan({
                personalPlan: 'free',
                authUserId: me,
                activeOwnerId: owner,
                ownerPlanById: { [owner]: '' },
            }),
        ).toBe('');
    });

    it('keeps FEATURE.team on personal plan even in foreign workspace', () => {
        expect(
            resolveEffectivePlan({
                personalPlan: 'free',
                authUserId: me,
                activeOwnerId: owner,
                ownerPlanById: { [owner]: 'enterprise' },
                featureKey: FEATURE.team,
            }),
        ).toBe('free');
    });
});

describe('inherited plan feature matrix', () => {
    const me = 'user-me';
    const owner = 'owner-ent';

    function can(key: (typeof FEATURE)[keyof typeof FEATURE], personal: string, ownerPlan: string) {
        const plan = resolveEffectivePlan({
            personalPlan: personal,
            authUserId: me,
            activeOwnerId: owner,
            ownerPlanById: { [owner]: ownerPlan },
            featureKey: key,
        });
        return planHasFeature(plan, key);
    }

    it('free member in enterprise workspace gets cupping and orders', () => {
        expect(can(FEATURE.cupping, 'free', 'enterprise')).toBe(true);
        expect(can(FEATURE.orderIntegration, 'free', 'enterprise')).toBe(true);
        expect(can(FEATURE.roastedInventory, 'free', 'enterprise')).toBe(true);
        expect(can(FEATURE.team, 'free', 'enterprise')).toBe(false);
    });

    it('free self workspace stays locked', () => {
        const plan = resolveEffectivePlan({
            personalPlan: 'free',
            authUserId: me,
            activeOwnerId: null,
            ownerPlanById: { [owner]: 'enterprise' },
            featureKey: FEATURE.cupping,
        });
        expect(planHasFeature(plan, FEATURE.cupping)).toBe(false);
    });
});
