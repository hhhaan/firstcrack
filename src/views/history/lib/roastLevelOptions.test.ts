import { FILTER_META_SELECT } from '@entities/roast/api';
import { describe, expect, it } from 'vitest';
import { buildRoastLevelFilterOptions, HISTORY_ROAST_LEVELS } from './roastLevelOptions';

describe('FILTER_META_SELECT (server facet)', () => {
    it('includes roast_level so History options are not page-bound', () => {
        expect(FILTER_META_SELECT).toContain('roast_level');
    });
});

describe('buildRoastLevelFilterOptions', () => {
    it('builds options from filterMeta, not the current page', () => {
        const filterMeta = [
            { roast_level: 'Dark' },
            { roast_level: 'Light' },
            { roast_level: 'Dark' },
            { roast_level: null },
        ];
        const currentPage = [{ roast_level: 'Medium' }];

        expect(buildRoastLevelFilterOptions(HISTORY_ROAST_LEVELS, currentPage)).toEqual(['Medium']);
        expect(buildRoastLevelFilterOptions(HISTORY_ROAST_LEVELS, filterMeta)).toEqual(['Light', 'Dark']);
    });

    it('returns empty when the facet has no levels (not when the page is empty)', () => {
        expect(buildRoastLevelFilterOptions(HISTORY_ROAST_LEVELS, [])).toEqual([]);
        expect(
            buildRoastLevelFilterOptions(HISTORY_ROAST_LEVELS, [{ roast_level: null }, { roast_level: '' }]),
        ).toEqual([]);
    });

    it('keeps canonical order and drops unknown values', () => {
        expect(
            buildRoastLevelFilterOptions(HISTORY_ROAST_LEVELS, [
                { roast_level: 'Medium-Dark' },
                { roast_level: 'Custom' },
                { roast_level: 'Medium-Light' },
            ]),
        ).toEqual(['Medium-Light', 'Medium-Dark']);
    });
});
