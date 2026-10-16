import { describe, expect, it } from 'vitest';
import { buildBlendDeductions } from './buildBlendDeductions';

const comp = (bean_id: string, ratio_pct: number) => ({ bean_id, ratio_pct });

describe('buildBlendDeductions', () => {
    it('returns empty for no components', () => {
        expect(buildBlendDeductions(5000, [])).toEqual([]);
    });

    it('allocates by ratio and last component absorbs remainder', () => {
        const result = buildBlendDeductions(1000, [comp('a', 33), comp('b', 33), comp('c', 34)]);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ beanId: 'a', grams: 330 });
        expect(result[1]).toEqual({ beanId: 'b', grams: 330 });
        // last gets remainder so total === charge
        expect(result[2].grams).toBe(1000 - 330 - 330);
        expect(result.reduce((s, d) => s + d.grams, 0)).toBe(1000);
    });

    it('single component takes full charge', () => {
        expect(buildBlendDeductions(2500, [comp('only', 100)])).toEqual([{ beanId: 'only', grams: 2500 }]);
    });

    it('50/50 split rounds first then remainder on last', () => {
        const result = buildBlendDeductions(1001, [comp('x', 50), comp('y', 50)]);
        expect(result[0].grams).toBe(501); // Math.round(1001 * 0.5)
        expect(result[1].grams).toBe(500);
        expect(result[0].grams + result[1].grams).toBe(1001);
    });

    it('orders by bean_id before giving the remainder to the last id', () => {
        const result = buildBlendDeductions(1001, [comp('y', 50), comp('x', 50)]);
        expect(result.map((row) => row.beanId)).toEqual(['x', 'y']);
        expect(result[0].grams).toBe(501);
        expect(result[1].grams).toBe(500);
    });
});
