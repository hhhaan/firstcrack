import { describe, expect, it } from 'vitest';
import { CONTROL_GRID_SPLIT, controlGridTickPercents } from './chart-config';

describe('controlGridTickPercents', () => {
    it('returns inclusive 0–100% marks for the shared control split', () => {
        expect(CONTROL_GRID_SPLIT).toBe(5);
        expect(controlGridTickPercents()).toEqual([0, 20, 40, 60, 80, 100]);
    });
});
