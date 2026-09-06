import { describe, expect, it } from 'vitest';
import {
    durationDiff,
    formatDate,
    formatDateShort,
    formatDuration,
    formatElapsed,
    gramsToKg,
    localeForDate,
    pctChange,
    sanitizeDecimal,
} from './format';

describe('sanitizeDecimal', () => {
    it('strips non-digits and keeps a single decimal point', () => {
        expect(sanitizeDecimal('12.3.4abc')).toBe('12.34');
        expect(sanitizeDecimal('1,2a3')).toBe('123');
        expect(sanitizeDecimal('')).toBe('');
    });
});

describe('formatElapsed', () => {
    it('formats seconds as m:ss with floored seconds', () => {
        expect(formatElapsed(0)).toBe('0:00');
        expect(formatElapsed(65)).toBe('1:05');
        expect(formatElapsed(90.6)).toBe('1:30');
        expect(formatElapsed(125.9)).toBe('2:05');
    });
});

describe('formatDuration', () => {
    it('returns em dash for null and rounds fractional seconds', () => {
        expect(formatDuration(null)).toBe('—');
        expect(formatDuration(0)).toBe('0:00');
        expect(formatDuration(65.4)).toBe('1:05');
        expect(formatDuration(65.6)).toBe('1:06');
        expect(formatDuration(90.6)).toBe('1:31');
    });
});

describe('formatDate', () => {
    it('returns em dash for null/empty and a short locale date for ISO', () => {
        expect(formatDate(null)).toBe('—');
        expect(formatDate('')).toBe('—');
        expect(formatDate('2024-03-15T12:00:00.000Z')).toMatch(/Mar\s+1[45]/);
    });
});

describe('gramsToKg', () => {
    it('converts grams with the requested digits', () => {
        expect(gramsToKg(2400)).toBe('2.40');
        expect(gramsToKg(1500, 1)).toBe('1.5');
        expect(gramsToKg(0)).toBe('0.00');
    });
});

describe('localeForDate', () => {
    it('defaults to en-US (including ko)', () => {
        expect(localeForDate()).toBe('en-US');
    });
});

describe('formatDateShort', () => {
    it('slices ISO to YY-MM-DD or em dash', () => {
        expect(formatDateShort(null)).toBe('—');
        expect(formatDateShort('2024-03-15T12:00:00.000Z')).toBe('24-03-15');
    });
});

describe('pctChange', () => {
    it('formats signed percent and dashes when previous is zero', () => {
        expect(pctChange(110, 100)).toBe('+10%');
        expect(pctChange(90, 100)).toBe('-10%');
        expect(pctChange(50, 0)).toBe('—');
        expect(pctChange(100, 100)).toBe('+0%');
    });
});

describe('durationDiff', () => {
    it('formats signed duration delta via formatDuration', () => {
        expect(durationDiff(130, 65)).toBe('+1:05');
        expect(durationDiff(60, 125)).toBe('-1:05');
        expect(durationDiff(10, 10)).toBe('+0:00');
    });
});
