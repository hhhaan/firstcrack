import { describe, expect, it } from 'vitest';
import { parseRoastColorReadings, roastColorAverage, roastColorDisplay } from './roastColorText';

describe('color measurements', () => {
    it('averages variable counts, decimals and zero without changing the source', () => {
        expect(roastColorAverage(' 50, 51, 52 ')).toBe(51);
        expect(roastColorDisplay('63, 64, 63')).toBe('63.33');
        expect(roastColorDisplay('0')).toBe('0.00');
        expect(roastColorDisplay('.5, 1.5')).toBe('1.00');
        expect(parseRoastColorReadings('50, 51, 52')).toEqual([50, 51, 52]);
    });

    it('distinguishes empty, invalid input and readable legacy text', () => {
        expect(parseRoastColorReadings('')).toEqual([]);
        for (const text of ['50,,51', '50,', '-1', 'Infinity', '50x', 'WB 58.4 (avg)']) {
            expect(parseRoastColorReadings(text)).toBeNull();
            expect(roastColorAverage(text)).toBeNull();
        }
        expect(roastColorDisplay(null)).toBe('—');
        expect(roastColorDisplay('WB 58.4 (avg)')).toBe('WB 58.4 (avg)');
    });
});
