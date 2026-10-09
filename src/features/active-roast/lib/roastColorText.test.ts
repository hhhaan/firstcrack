import { describe, expect, it } from 'vitest';
import { isRoastColorTooLong, normalizeRoastColorText, ROAST_COLOR_MAX_LENGTH } from './roastColorText';

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
