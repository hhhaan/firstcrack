import { describe, expect, it } from 'vitest';
import { calcTargetDelta } from './display-derivatives';

// 0s:200° → 60s:180° 직선 타겟
const target = [
    { t: 0, bt: 200 },
    { t: 60, bt: 180 },
];

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
