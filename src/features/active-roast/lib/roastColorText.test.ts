import { describe, expect, it } from 'vitest';
import {
    isRoastColorTooLong,
    normalizeRoastColorText,
    parseRoastColorReadings,
    ROAST_COLOR_MAX_LENGTH,
    roastColorAverage,
    roastColorDisplay,
} from './roastColorText';

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

describe('normalizeRoastColorText', () => {
    it('returns null for blank input', () => {
        expect(normalizeRoastColorText('')).toBeNull();
        expect(normalizeRoastColorText('   ')).toBeNull();
        expect(normalizeRoastColorText(null)).toBeNull();
        expect(normalizeRoastColorText(undefined)).toBeNull();
    });

    it('trims surrounding whitespace only', () => {
        expect(normalizeRoastColorText('  58.4, 58.7, 59.0  ')).toBe('58.4, 58.7, 59.0');
        expect(normalizeRoastColorText('WB 58.4 (avg)')).toBe('WB 58.4 (avg)');
        expect(normalizeRoastColorText('홀빈 58')).toBe('홀빈 58');
        expect(normalizeRoastColorText('58 / 60')).toBe('58 / 60');
    });

    it('does not parse or reformat numbers', () => {
        expect(normalizeRoastColorText('058.40')).toBe('058.40');
    });
});

describe('ROAST_COLOR_MAX_LENGTH', () => {
    it('matches bean label cap', () => {
        expect(ROAST_COLOR_MAX_LENGTH).toBe(120);
    });
});

describe('isRoastColorTooLong', () => {
    it('measures trimmed length only', () => {
        expect(isRoastColorTooLong(`  ${'a'.repeat(120)}  `)).toBe(false);
        expect(isRoastColorTooLong(`  ${'a'.repeat(121)}  `)).toBe(true);
    });
});
