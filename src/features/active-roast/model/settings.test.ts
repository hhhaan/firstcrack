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
    it('clamps out-of-range yellow temp', () => {
        expect(normalizeRoastSettings({ yellowTempC: 400 })).toMatchObject({ yellowTempC: 300 });
        expect(normalizeRoastSettings({ yellowTempC: 10 })).toMatchObject({ yellowTempC: 50 });
    });

    it('keeps a valid yellow temp', () => {
        expect(normalizeRoastSettings({ yellowTempC: 160 })).toMatchObject({ yellowTempC: 160 });
    });

    it('defaults fcDualMarkEnabled to false', () => {
        expect(normalizeRoastSettings({})).toMatchObject({ fcDualMarkEnabled: false });
    });

    it('normalizes fcDualMarkEnabled boolean', () => {
        expect(normalizeRoastSettings({ fcDualMarkEnabled: true })).toMatchObject({ fcDualMarkEnabled: true });
        expect(normalizeRoastSettings({ fcDualMarkEnabled: false })).toMatchObject({ fcDualMarkEnabled: false });
    });

    it('defaults dual mark when only legacy FC auto keys are present', () => {
        const s = normalizeRoastSettings({
            // legacy store may still hold these; typed settings no longer include them
            autoFcStartEnabled: true,
            fcStartTempC: 195,
        } as Partial<import('./settings').RoastSettings>);
        expect(s.fcDualMarkEnabled).toBe(false);
        expect(s.autoYellowEnabled).toBe(true);
    });
});

describe('normalize — time alerts', () => {
    it('defaults time alarms off with Cropster 3.1 minute values', () => {
        expect(normalizeRoastSettings({})).toMatchObject({
            alertAfterChargeEnabled: false,
            alertAfterChargeMin: 5,
            alertBeforeFcEnabled: false,
            alertBeforeFcMin: 1,
            alertBeforeDropEnabled: false,
            alertBeforeDropMin: 1,
            alertAfterDropEnabled: false,
            alertAfterDropMin: 5,
        });
    });

    it('clamps time-alarm minutes to 1–30', () => {
        expect(normalizeRoastSettings({ alertAfterChargeMin: 0 }).alertAfterChargeMin).toBe(1);
        expect(normalizeRoastSettings({ alertBeforeFcMin: 99 }).alertBeforeFcMin).toBe(30);
    });
});

describe('normalize — alert sound kind', () => {
    it('defaults alertSoundKind to pulse', () => {
        expect(normalizeRoastSettings({})).toMatchObject({ alertSoundKind: 'pulse' });
    });

    it('keeps a known kind and falls back to pulse on an unknown one', () => {
        expect(normalizeRoastSettings({ alertSoundKind: 'kalimba' })).toMatchObject({ alertSoundKind: 'kalimba' });
        expect(normalizeRoastSettings({ alertSoundKind: 'siren' } as never)).toMatchObject({ alertSoundKind: 'pulse' });
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
