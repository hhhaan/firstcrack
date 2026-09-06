import { describe, expect, it } from 'vitest';
import { blendSegmentsFromComponents, blendTotalRatio } from './lib';
import { coloredSegmentsFromSources } from './ui/BlendCompositionBar';

describe('blendTotalRatio', () => {
    it('sums ratio_pct', () => {
        expect(blendTotalRatio([{ ratio_pct: 40 }, { ratio_pct: 60 }])).toBe(100);
        expect(blendTotalRatio([])).toBe(0);
        expect(blendTotalRatio([{ ratio_pct: Number.NaN }])).toBe(0);
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

describe('coloredSegmentsFromSources', () => {
    it('assigns palette colors without dropping ratio/label', () => {
        const colored = coloredSegmentsFromSources([
            { ratioPct: 70, label: 'Brazil', id: 'c1' },
            { ratioPct: 30, label: 'Ethiopia' },
        ]);
        expect(colored).toHaveLength(2);
        expect(colored[0]).toMatchObject({ ratioPct: 70, label: 'Brazil', id: 'c1' });
        expect(colored[0].color).toBeTruthy();
        expect(colored[1].color).not.toBe(colored[0].color);
    });
});
