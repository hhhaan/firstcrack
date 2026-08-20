import { describe, expect, it } from 'vitest';
import { FEATURE, type FeatureKey } from './keys';
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

describe('planHasFeature machineControl', () => {
    it('Pro+ 이상만 머신 쓰기 제어를 쓸 수 있다', () => {
        expect(planHasFeature('pro_plus', FEATURE.machineControl)).toBe(true);
        expect(planHasFeature('enterprise', FEATURE.machineControl)).toBe(true);
        expect(planHasFeature('team', FEATURE.machineControl)).toBe(true);
        expect(planHasFeature('tester', FEATURE.machineControl)).toBe(true);
    });

    it('Pro 이하는 막힌다 — trial도 포함', () => {
        expect(planHasFeature('pro', FEATURE.machineControl)).toBe(false);
        expect(planHasFeature('trial', FEATURE.machineControl)).toBe(false);
        expect(planHasFeature('free', FEATURE.machineControl)).toBe(false);
        expect(planHasFeature('read_only', FEATURE.machineControl)).toBe(false);
        expect(planHasFeature('', FEATURE.machineControl)).toBe(false);
    });

    it('cupping/fastPolling(Pro 코어)보다 상위 등급이다', () => {
        expect(planHasFeature('pro', FEATURE.cupping)).toBe(true);
        expect(planHasFeature('pro', FEATURE.machineControl)).toBe(false);
    });
});

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

    it('isWritablePlan: only known writable plans', () => {
        expect(isWritablePlan('read_only')).toBe(false);
        expect(isWritablePlan('trial')).toBe(true);
        expect(isWritablePlan('pro')).toBe(true);
        expect(isWritablePlan('free')).toBe(true);
        expect(isWritablePlan('nope')).toBe(false);
        expect(isWritablePlan('')).toBe(false);
    });

    it('planHasFeature is exhaustive over FeatureKey (no silent-deny default)', () => {
        const pro: Record<FeatureKey, boolean> = {
            cupping: true,
            orderIntegration: false,
            bbp: true,
            roastedInventory: false,
            productStock: false,
            team: false,
            fastPolling: true,
            machineControl: false,
        };
        for (const key of Object.values(FEATURE)) {
            expect(planHasFeature('pro', key)).toBe(pro[key]);
        }
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

    it('grants team to enterprise-class only', () => {
        expect(planHasFeature('free', FEATURE.team)).toBe(false);
        expect(planHasFeature('pro', FEATURE.team)).toBe(false);
        expect(planHasFeature('pro_plus', FEATURE.team)).toBe(false);
        expect(planHasFeature('enterprise', FEATURE.team)).toBe(true);
        expect(planHasFeature('team', FEATURE.team)).toBe(true);
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

describe('tester plan', () => {
    it('matches enterprise on every gate', () => {
        for (const key of Object.values(FEATURE)) {
            expect(planHasFeature('tester', key)).toBe(planHasFeature('enterprise', key));
        }
        expect(isPaidPlan('tester')).toBe(isPaidPlan('enterprise'));
        expect(isCoreEntitled('tester')).toBe(true);
        expect(isWritablePlan('tester')).toBe(true);
        expect(planMaxMachines('tester')).toBeNull();
        expect(planMaxBatchesPerMonth('tester')).toBeNull();
        expect(planHasFeature('tester', FEATURE.team)).toBe(true);
        expect(planHasFeature('tester', FEATURE.orderIntegration)).toBe(true);
    });
});
