import { describe, expect, it } from 'vitest';
import { FEATURE } from './keys';
import { isPaidPlan, planHasFeature } from './plan-matrix';
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
