import { FEATURE, planHasFeature } from '@shared/lib/features';
import { describe, expect, it } from 'vitest';
import { coercePollIntervalForPlan, normalizeRoastSettings } from './settings';

describe('coercePollIntervalForPlan', () => {
    it('coerces stored 500ms to 1s when the plan lacks fast polling', () => {
        expect(coercePollIntervalForPlan(500, false)).toBe(1000);
    });

    it('keeps 500ms for entitled plans', () => {
        expect(coercePollIntervalForPlan(500, true)).toBe(500);
    });

    it('never touches 1s', () => {
        expect(coercePollIntervalForPlan(1000, false)).toBe(1000);
        expect(coercePollIntervalForPlan(1000, true)).toBe(1000);
    });
});

describe('normalize — phase temperatures', () => {
    it('clamps out-of-range values, then resets both when Yellow ≥ FC', () => {
        // 400/500은 clamp 후 300/300 → 역전(>=) → 둘 다 기본값. clamp가 없으면 400이 그대로 남는다.
        expect(normalizeRoastSettings({ yellowTempC: 400, fcStartTempC: 500 })).toMatchObject({
            yellowTempC: 150,
            fcStartTempC: 200,
        });
    });

    it('resets both on plain inversion', () => {
        expect(normalizeRoastSettings({ yellowTempC: 210, fcStartTempC: 200 })).toMatchObject({
            yellowTempC: 150,
            fcStartTempC: 200,
        });
    });

    it('keeps an inverted pair when either auto-mark toggle is off', () => {
        expect(normalizeRoastSettings({ yellowTempC: 210, fcStartTempC: 200, autoYellowEnabled: false })).toMatchObject(
            { yellowTempC: 210, fcStartTempC: 200 },
        );
        expect(
            normalizeRoastSettings({ yellowTempC: 210, fcStartTempC: 200, autoFcStartEnabled: false }),
        ).toMatchObject({ yellowTempC: 210, fcStartTempC: 200 });
    });

    it('keeps a valid in-range pair', () => {
        expect(normalizeRoastSettings({ yellowTempC: 160, fcStartTempC: 195 })).toMatchObject({
            yellowTempC: 160,
            fcStartTempC: 195,
        });
    });
});

describe('FEATURE.fastPolling plan matrix', () => {
    it('grants Pro core level (trial runs at Pro)', () => {
        for (const plan of ['trial', 'pro', 'pro_plus', 'enterprise', 'team']) {
            expect(planHasFeature(plan, FEATURE.fastPolling)).toBe(true);
        }
    });

    it('denies free / read_only / unresolved placeholder', () => {
        for (const plan of ['free', 'read_only', '']) {
            expect(planHasFeature(plan, FEATURE.fastPolling)).toBe(false);
        }
    });
});
