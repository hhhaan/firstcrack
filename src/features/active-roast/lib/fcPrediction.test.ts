import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FC_TARGET_C,
    extractFcStartBt,
    predictFcTime,
    resolveFcTargetC,
    shouldShowFcPrediction,
    smoothFcPrediction,
} from './fcPrediction';

describe('predictFcTime', () => {
    it('extrapolates linearly from BT and RoR', () => {
        // 8:00, 180°C, 8°C/min → 196°C in 2 min → 10:00
        expect(predictFcTime(480, 180, 8, 196)).toBe(600);
    });

    it('returns null when RoR is stalled or BT has reached the target', () => {
        expect(predictFcTime(480, 180, 0.5, 196)).toBeNull();
        expect(predictFcTime(480, 180, 0, 196)).toBeNull();
        expect(predictFcTime(480, 196, 8, 196)).toBeNull();
        expect(predictFcTime(480, 200, 8, 196)).toBeNull();
    });
});

describe('resolveFcTargetC', () => {
    it('uses the recent-session median, then reference BT, then 196', () => {
        expect(resolveFcTargetC([190, 196, 200], 188)).toBe(196);
        expect(resolveFcTargetC([190, 200], null)).toBe(195);
        expect(resolveFcTargetC([], 188)).toBe(188);
        expect(resolveFcTargetC([], null)).toBe(DEFAULT_FC_TARGET_C);
    });
});

describe('extractFcStartBt', () => {
    it('reads FC Start temp_c from stored events', () => {
        expect(
            extractFcStartBt([
                { id: '1', type: 'Yellow', time_sec: 300, temp_c: 150 },
                { id: '2', type: 'FC Start', time_sec: 540, temp_c: 197.4 },
            ]),
        ).toBe(197.4);
        expect(extractFcStartBt([{ id: '1', type: 'Drop', time_sec: 700, temp_c: 205 }])).toBeNull();
        expect(extractFcStartBt(null)).toBeNull();
    });
});

describe('shouldShowFcPrediction', () => {
    const base = {
        hasYellow: false,
        hasFcStart: false,
        hasDrop: false,
        bt: 150,
        fcTargetC: 196,
        charged: true,
        roastEnded: false,
    };

    it('gates on Yellow or BT within 40°C of target, and hides after FC/Drop', () => {
        expect(shouldShowFcPrediction(base)).toBe(false);
        expect(shouldShowFcPrediction({ ...base, hasYellow: true })).toBe(true);
        expect(shouldShowFcPrediction({ ...base, bt: 157 })).toBe(true);
        expect(shouldShowFcPrediction({ ...base, hasYellow: true, hasFcStart: true })).toBe(false);
        expect(shouldShowFcPrediction({ ...base, hasYellow: true, hasDrop: true })).toBe(false);
        expect(shouldShowFcPrediction({ ...base, hasYellow: true, charged: false })).toBe(false);
    });
});

describe('smoothFcPrediction', () => {
    it('applies EMA and clears when the raw prediction drops out', () => {
        expect(smoothFcPrediction(null, 600)).toBe(600);
        expect(smoothFcPrediction(600, 500)).toBe(570);
        expect(smoothFcPrediction(570, null)).toBeNull();
    });
});
