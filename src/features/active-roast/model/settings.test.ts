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

describe('normalize — alert sound volume', () => {
    it('defaults to 100 for a noisy roast floor', () => {
        expect(normalizeRoastSettings({})).toMatchObject({ alertSoundVolume: 100 });
    });

    it('clamps out of 10–100', () => {
        expect(normalizeRoastSettings({ alertSoundVolume: 0 })).toMatchObject({ alertSoundVolume: 10 });
        expect(normalizeRoastSettings({ alertSoundVolume: 150 })).toMatchObject({ alertSoundVolume: 100 });
    });

    it('keeps a valid volume', () => {
        expect(normalizeRoastSettings({ alertSoundVolume: 40 })).toMatchObject({ alertSoundVolume: 40 });
    });

    it('defaults tone to soft', () => {
        expect(normalizeRoastSettings({})).toMatchObject({ alertSoundTone: 'soft' });
    });

    it('keeps alarm tone', () => {
        expect(normalizeRoastSettings({ alertSoundTone: 'alarm' })).toMatchObject({ alertSoundTone: 'alarm' });
    });

    it('falls back on unknown tone', () => {
        expect(normalizeRoastSettings({ alertSoundTone: 'siren' as never })).toMatchObject({ alertSoundTone: 'soft' });
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
