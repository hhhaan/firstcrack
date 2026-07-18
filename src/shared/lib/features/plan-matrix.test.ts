import { describe, expect, it } from 'vitest';
import { FEATURE } from './keys';
import {
    canAddMachine,
    canCompleteBatch,
    isPaidPlan,
    PRO_MONTHLY_BATCH_CAP,
    planHasFeature,
    planMaxBatchesPerMonth,
    planMaxMachines,
} from './plan-matrix';
import { resolveFeature } from './resolve';

describe('planHasFeature cupping', () => {
    it('allows paid plans', () => {
        expect(planHasFeature('pro', FEATURE.cupping)).toBe(true);
        expect(planHasFeature('team', FEATURE.cupping)).toBe(true);
        expect(planHasFeature('pro_plus', FEATURE.cupping)).toBe(true);
        expect(planHasFeature('enterprise', FEATURE.cupping)).toBe(true);
    });

    it('denies free / trial / read_only', () => {
        expect(planHasFeature('free', FEATURE.cupping)).toBe(false);
        expect(planHasFeature('trial', FEATURE.cupping)).toBe(false);
        expect(planHasFeature('read_only', FEATURE.cupping)).toBe(false);
        expect(planHasFeature('', FEATURE.cupping)).toBe(false);
    });
});

describe('planHasFeature bbp', () => {
    it('allows paid plans', () => {
        expect(planHasFeature('pro', FEATURE.bbp)).toBe(true);
        expect(planHasFeature('team', FEATURE.bbp)).toBe(true);
        expect(planHasFeature('pro_plus', FEATURE.bbp)).toBe(true);
        expect(planHasFeature('enterprise', FEATURE.bbp)).toBe(true);
    });

    it('denies free / trial / read_only', () => {
        expect(planHasFeature('free', FEATURE.bbp)).toBe(false);
        expect(planHasFeature('trial', FEATURE.bbp)).toBe(false);
        expect(planHasFeature('read_only', FEATURE.bbp)).toBe(false);
        expect(planHasFeature('', FEATURE.bbp)).toBe(false);
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

    it('canCompleteBatch', () => {
        expect(canCompleteBatch('pro', 199)).toBe(true);
        expect(canCompleteBatch('pro', 200)).toBe(false);
        expect(canCompleteBatch('pro_plus', 500)).toBe(true);
    });
});
