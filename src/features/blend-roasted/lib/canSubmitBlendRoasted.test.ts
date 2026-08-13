import { describe, expect, it } from 'vitest';
import { canSubmitBlendRoasted } from './canSubmitBlendRoasted';

const ok = {
    blendId: 'b1',
    hasSelection: true,
    inputSum: 1000,
    outputGrams: 800,
    isPending: false,
    anyOver: false,
};

describe('canSubmitBlendRoasted', () => {
    it('allows a balanced in-stock blend', () => {
        expect(canSubmitBlendRoasted(ok)).toBe(true);
    });

    it('blocks over-stock and output > input', () => {
        expect(canSubmitBlendRoasted({ ...ok, anyOver: true })).toBe(false);
        expect(canSubmitBlendRoasted({ ...ok, outputGrams: 1200 })).toBe(false);
    });
});
