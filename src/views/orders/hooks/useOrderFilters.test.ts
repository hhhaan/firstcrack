import { describe, expect, it } from 'vitest';
import { clampPage } from './useOrderFilters';

describe('clampPage', () => {
    it('leaves a valid page alone', () => {
        expect(clampPage(2, 40, 20)).toBe(2);
    });

    it('drops back when page is past the last page', () => {
        expect(clampPage(3, 15, 20)).toBe(1);
        expect(clampPage(5, 21, 20)).toBe(2);
    });

    it('never goes below 1, even with an empty result', () => {
        expect(clampPage(2, 0, 20)).toBe(1);
        expect(clampPage(0, 10, 20)).toBe(1);
    });
});
