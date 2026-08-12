import { describe, expect, it } from 'vitest';
import type { LiveRoastPoint } from '../model/useSidecarPolling';
import { calcDelta, calcTargetDelta } from './display-derivatives';

// 0s:200° → 60s:180° 직선 타겟
const target = [
    { t: 0, bt: 200 },
    { t: 60, bt: 180 },
];

const live = (time: number, bt: number, et: number | null = bt + 10): LiveRoastPoint => ({
    time,
    label: '0:00',
    bt,
    et,
    ror: 0,
    ror_et: 0,
    heater: 0,
    fan: 0,
    drum: 0,
});

describe('calcDelta', () => {
    it('returns null with fewer than two post-charge points', () => {
        expect(calcDelta([], 'C')).toEqual({ deltaBT: null, deltaET: null });
        expect(calcDelta([live(0, 150)], 'C')).toEqual({ deltaBT: null, deltaET: null });
        expect(calcDelta([live(-5, 200), live(0, 150)], 'C')).toEqual({ deltaBT: null, deltaET: null });
    });

    it('compares current BT/ET against ~30s earlier (ignores pre-charge)', () => {
        const points = [live(-10, 220), live(0, 150), live(15, 160), live(30, 170), live(45, 180)];
        // current 45s vs closest to 15s → 180-160
        expect(calcDelta(points, 'C')).toEqual({ deltaBT: '20.0', deltaET: '20.0' });
    });

    it('converts delta into display unit', () => {
        const points = [live(0, 100), live(30, 110)];
        // 10°C → 18°F
        expect(calcDelta(points, 'F')).toEqual({ deltaBT: '18.0', deltaET: '18.0' });
    });

    it('null ET delta when either sample lacks ET', () => {
        const points = [live(0, 100, null), live(30, 110, 120)];
        expect(calcDelta(points, 'C')).toEqual({ deltaBT: '10.0', deltaET: null });
    });
});

describe('calcTargetDelta', () => {
    it('classifies within band (±2°C)', () => {
        const r = calcTargetDelta(191, target, 30, 'C');
        expect(r).toEqual({ deltaDisplay: 1, status: 'within' });
    });

    it('classifies over / under beyond band', () => {
        expect(calcTargetDelta(195, target, 30, 'C')?.status).toBe('over');
        expect(calcTargetDelta(185, target, 30, 'C')?.status).toBe('under');
    });

    it('interpolates target at elapsed time', () => {
        const r = calcTargetDelta(190, target, 15, 'C');
        expect(r?.deltaDisplay).toBeCloseTo(-5); // target at 15s = 195
    });

    it('converts delta to display unit while banding in celsius', () => {
        const r = calcTargetDelta(203, target, 0, 'F');
        expect(r?.status).toBe('over'); // +3°C > 2°C band
        expect(r?.deltaDisplay).toBeCloseTo(5.4); // 3°C × 9/5
    });

    it('returns null without BT or target curve', () => {
        expect(calcTargetDelta(null, target, 30, 'C')).toBeNull();
        expect(calcTargetDelta(190, [], 30, 'C')).toBeNull();
    });
});
