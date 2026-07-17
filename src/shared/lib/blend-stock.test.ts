import { describe, expect, it } from 'vitest';
import {
    blendMaxRoastableGrams,
    blendRoastableByBlends,
    blendToRoastableInputs,
    EMPTY_BLEND_ROASTABLE,
} from './blend-stock';

describe('blendMaxRoastableGrams', () => {
    it('returns empty for no components', () => {
        expect(blendMaxRoastableGrams([])).toEqual(EMPTY_BLEND_ROASTABLE);
    });

    it('returns empty when any ratio is zero', () => {
        expect(
            blendMaxRoastableGrams([
                { beanId: 'a', beanName: 'A', ratioPct: 0, effectiveGrams: 1000 },
                { beanId: 'b', beanName: 'B', ratioPct: 100, effectiveGrams: 1000 },
            ]),
        ).toEqual(EMPTY_BLEND_ROASTABLE);
    });

    it('limits by scarcest component relative to ratio', () => {
        // A: 600g at 60% → max charge floor(600*100/60)=1000
        // B: 300g at 40% → max charge floor(300*100/40)=750  ← limiting
        const result = blendMaxRoastableGrams([
            { beanId: 'a', beanName: 'A', ratioPct: 60, effectiveGrams: 600 },
            { beanId: 'b', beanName: 'B', ratioPct: 40, effectiveGrams: 300 },
        ]);
        expect(result.maxGrams).toBe(750);
        expect(result.limitingBeanId).toBe('b');
        expect(result.limitingBeanName).toBe('B');
        expect(result.limitingEffectiveGrams).toBe(300);
    });

    it('handles single component 100%', () => {
        const result = blendMaxRoastableGrams([
            { beanId: 'only', beanName: 'Only', ratioPct: 100, effectiveGrams: 2500 },
        ]);
        expect(result.maxGrams).toBe(2500);
        expect(result.limitingBeanId).toBe('only');
    });
});

describe('blendToRoastableInputs / blendRoastableByBlends', () => {
    const blend = {
        id: 'blend-1',
        blend_components: [
            { bean_id: 'a', ratio_pct: 50, beans: { name: 'A' } },
            { bean_id: 'b', ratio_pct: 50, beans: { name: 'B' } },
        ],
    };

    it('maps stock summaries into roastable inputs (0 when missing)', () => {
        const inputs = blendToRoastableInputs(blend, { a: { effectiveGrams: 1000 } });
        expect(inputs).toEqual([
            { beanId: 'a', beanName: 'A', ratioPct: 50, effectiveGrams: 1000 },
            { beanId: 'b', beanName: 'B', ratioPct: 50, effectiveGrams: 0 },
        ]);
    });

    it('indexes roastable result by blend id', () => {
        const map = blendRoastableByBlends([blend], {
            a: { effectiveGrams: 1000 },
            b: { effectiveGrams: 1000 },
        });
        expect(map['blend-1'].maxGrams).toBe(2000);
    });
});
