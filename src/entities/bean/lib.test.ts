import { describe, expect, it } from 'vitest';
import { getStatus } from './lib';

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
