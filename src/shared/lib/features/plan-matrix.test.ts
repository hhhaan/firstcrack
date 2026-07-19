import { describe, expect, it } from 'vitest';
import { FEATURE } from './keys';
import {
    canAddMachine,
    canCompleteBatch,
    isCoreEntitled,
    isPaidPlan,
    isWritablePlan,
    PRO_MONTHLY_BATCH_CAP,
    planHasFeature,
    planMaxBatchesPerMonth,
    planMaxMachines,
    TRIAL_DURATION_DAYS,
    trialEndsAt,
} from './plan-matrix';
import { resolveFeature } from './resolve';

describe('planHasFeature cupping', () => {
    it('allows core-entitled plans (trial included)', () => {
        expect(planHasFeature('trial', FEATURE.cupping)).toBe(true);
        expect(planHasFeature('pro', FEATURE.cupping)).toBe(true);
        expect(planHasFeature('team', FEATURE.cupping)).toBe(true);
        expect(planHasFeature('pro_plus', FEATURE.cupping)).toBe(true);
        expect(planHasFeature('enterprise', FEATURE.cupping)).toBe(true);
    });

    it('denies free / read_only', () => {
        expect(planHasFeature('free', FEATURE.cupping)).toBe(false);
        expect(planHasFeature('read_only', FEATURE.cupping)).toBe(false);
        expect(planHasFeature('', FEATURE.cupping)).toBe(false);
    });
});

describe('planHasFeature bbp', () => {
    it('allows core-entitled plans (trial included)', () => {
        expect(planHasFeature('trial', FEATURE.bbp)).toBe(true);
        expect(planHasFeature('pro', FEATURE.bbp)).toBe(true);
        expect(planHasFeature('team', FEATURE.bbp)).toBe(true);
        expect(planHasFeature('pro_plus', FEATURE.bbp)).toBe(true);
        expect(planHasFeature('enterprise', FEATURE.bbp)).toBe(true);
    });

    it('denies free / read_only', () => {
        expect(planHasFeature('free', FEATURE.bbp)).toBe(false);
        expect(planHasFeature('read_only', FEATURE.bbp)).toBe(false);
        expect(planHasFeature('', FEATURE.bbp)).toBe(false);
    });
});

describe('plan state helpers', () => {
    it('isCoreEntitled: trial + paid only', () => {
        expect(isCoreEntitled('trial')).toBe(true);
        expect(isCoreEntitled('pro')).toBe(true);
        expect(isCoreEntitled('read_only')).toBe(false);
        expect(isCoreEntitled('free')).toBe(false);
    });

    it('isWritablePlan: only read_only is blocked', () => {
        expect(isWritablePlan('read_only')).toBe(false);
        expect(isWritablePlan('trial')).toBe(true);
        expect(isWritablePlan('pro')).toBe(true);
        expect(isWritablePlan('free')).toBe(true);
    });

    it('trialEndsAt adds 14 days', () => {
        const end = trialEndsAt('2026-07-01T00:00:00Z');
        expect(end.toISOString()).toBe(`2026-07-${1 + TRIAL_DURATION_DAYS}T00:00:00.000Z`);
    });
});

describe('roasted inventory / product stock gating', () => {
    it('grants roastedInventory to Pro+ and above only', () => {
        expect(planHasFeature('free', FEATURE.roastedInventory)).toBe(false);
        expect(planHasFeature('pro', FEATURE.roastedInventory)).toBe(false);
        expect(planHasFeature('pro_plus', FEATURE.roastedInventory)).toBe(true);
        expect(planHasFeature('enterprise', FEATURE.roastedInventory)).toBe(true);
        expect(planHasFeature('team', FEATURE.roastedInventory)).toBe(true);
    });

    it('grants productStock to Pro+ and above only', () => {
        expect(planHasFeature('free', FEATURE.productStock)).toBe(false);
        expect(planHasFeature('pro', FEATURE.productStock)).toBe(false);
        expect(planHasFeature('pro_plus', FEATURE.productStock)).toBe(true);
        expect(planHasFeature('enterprise', FEATURE.productStock)).toBe(true);
        expect(planHasFeature('team', FEATURE.productStock)).toBe(true);
    });
});

describe('resolveFeature', () => {
    it('uses plan matrix by default', () => {
        expect(resolveFeature(FEATURE.cupping, { plan: 'pro' })).toBe(true);
        expect(resolveFeature(FEATURE.cupping, { plan: 'free' })).toBe(false);
    });

    it('profile override wins', () => {
        const off = new Map([[FEATURE.cupping, false]]);
        const on = new Map([[FEATURE.cupping, true]]);
        expect(resolveFeature(FEATURE.cupping, { plan: 'pro', profileOverrides: off })).toBe(false);
        expect(resolveFeature(FEATURE.cupping, { plan: 'free', profileOverrides: on })).toBe(true);
    });
});

describe('isPaidPlan', () => {
    it('classifies plans', () => {
        expect(isPaidPlan('pro')).toBe(true);
        expect(isPaidPlan('free')).toBe(false);
    });
});

describe('planMaxMachines', () => {
    it('limits plans below Pro+ to 1', () => {
        expect(planMaxMachines('free')).toBe(1);
        expect(planMaxMachines('pro')).toBe(1);
        expect(planMaxMachines('trial')).toBe(1);
    });

    it('unlimited for Pro+ / enterprise / legacy team', () => {
        expect(planMaxMachines('pro_plus')).toBeNull();
        expect(planMaxMachines('enterprise')).toBeNull();
        expect(planMaxMachines('team')).toBeNull();
    });

    it('canAddMachine respects count', () => {
        expect(canAddMachine('pro', 0)).toBe(true);
        expect(canAddMachine('pro', 1)).toBe(false);
        expect(canAddMachine('pro_plus', 5)).toBe(true);
    });
});

describe('planMaxBatchesPerMonth', () => {
    it('caps free/pro at 200', () => {
        expect(planMaxBatchesPerMonth('free')).toBe(PRO_MONTHLY_BATCH_CAP);
        expect(planMaxBatchesPerMonth('pro')).toBe(200);
    });

    it('unlimited for Pro+', () => {
        expect(planMaxBatchesPerMonth('pro_plus')).toBeNull();
        expect(planMaxBatchesPerMonth('enterprise')).toBeNull();
    });

    it('read_only completes nothing', () => {
        expect(planMaxBatchesPerMonth('read_only')).toBe(0);
        expect(canCompleteBatch('read_only', 0)).toBe(false);
    });

    it('canCompleteBatch', () => {
        expect(canCompleteBatch('pro', 199)).toBe(true);
        expect(canCompleteBatch('pro', 200)).toBe(false);
        expect(canCompleteBatch('pro_plus', 500)).toBe(true);
    });
});
