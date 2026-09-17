import { describe, expect, it } from 'vitest';
import { convergeTolerance, divergeTolerance, heaterScale } from './controlScale';

describe('controlScale (#428)', () => {
    it('미지/비정상 max는 0~100 전제', () => {
        expect(heaterScale(undefined)).toBe(100);
        expect(heaterScale(null)).toBe(100);
        expect(heaterScale(0)).toBe(100);
        expect(heaterScale(-10)).toBe(100);
    });

    it('0~100: 수렴 1 · 이탈 2 (기존)', () => {
        expect(convergeTolerance(100)).toBe(1);
        expect(divergeTolerance(100)).toBe(2);
        expect(divergeTolerance(undefined)).toBe(2);
    });

    it('0~10: 수렴 1 · 이탈 1 — 잔차 1은 추종, 2스텝(5→7)은 이탈', () => {
        expect(convergeTolerance(10)).toBe(1);
        expect(divergeTolerance(10)).toBe(1);
        expect(divergeTolerance(10)).toBeLessThan(2);
    });

    it('이탈 허용치는 항상 수렴 허용치 이상', () => {
        for (const max of [undefined, null, 5, 10, 50, 100, 200]) {
            expect(divergeTolerance(max)).toBeGreaterThanOrEqual(convergeTolerance(max));
        }
    });
});
