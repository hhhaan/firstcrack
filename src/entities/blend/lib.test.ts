import { describe, expect, it } from 'vitest';
import { blendSegmentsFromComponents, blendTotalRatio } from './lib';

describe('blendTotalRatio', () => {
    it('sums ratio_pct', () => {
        expect(blendTotalRatio([{ ratio_pct: 40 }, { ratio_pct: 60 }])).toBe(100);
        expect(blendTotalRatio([])).toBe(0);
        expect(blendTotalRatio([{ ratio_pct: Number.NaN as unknown as number }])).toBe(0);
    });
});

describe('blendSegmentsFromComponents', () => {
    it('maps named components for composition bar', () => {
        expect(
            blendSegmentsFromComponents([
                { ratio_pct: 70, beans: { name: 'Brazil' }, id: 'c1' },
                { ratio_pct: 30, beans: { name: 'Ethiopia' } },
            ]),
        ).toEqual([
            { ratioPct: 70, label: 'Brazil', id: 'c1' },
            { ratioPct: 30, label: 'Ethiopia', id: undefined },
        ]);
    });
});
