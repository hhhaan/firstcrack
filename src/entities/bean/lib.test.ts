import { describe, expect, it } from 'vitest';
import { getStatus, stockLevelPct } from './lib';

describe('getStatus', () => {
    it('Out when effective <= 0', () => {
        expect(getStatus(0, 1000)).toBe('Out');
        expect(getStatus(-10, 1000)).toBe('Out');
    });

    it('Low when at or below threshold', () => {
        expect(getStatus(1000, 1000)).toBe('Low');
        expect(getStatus(500, 1000)).toBe('Low');
    });

    it('Good when above threshold', () => {
        expect(getStatus(1001, 1000)).toBe('Good');
    });
});

describe('stockLevelPct', () => {
    it('clamps negative stock to 0', () => {
        expect(stockLevelPct(-5000, 5000)).toBe(0);
    });

    it('clamps over capacity to 100', () => {
        expect(stockLevelPct(10_000, 5000)).toBe(100);
    });

    it('returns ratio within range', () => {
        expect(stockLevelPct(2500, 5000)).toBe(50);
    });

    it('returns 0 when capacity is 0 or negative', () => {
        expect(stockLevelPct(1000, 0)).toBe(0);
        expect(stockLevelPct(1000, -1)).toBe(0);
    });
});
