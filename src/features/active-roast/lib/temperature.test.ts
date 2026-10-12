import { describe, expect, it } from 'vitest';
import {
    formatTemp,
    fromDisplayRoR,
    fromDisplayTemp,
    parseRorTicks,
    parseTemperatureTicks,
    rorUnitLabel,
    tempUnitLabel,
    toDisplayRoR,
    toDisplayTemp,
} from './temperature';

it('parses temperature tick lists, rejects invalid values, and stores physical Celsius values', () => {
    expect(parseTemperatureTicks('200, 100, 180, 100', 'C')).toEqual([100, 180, 200]);
    expect(parseTemperatureTicks('212, 356, 392', 'F')).toEqual([100, 180, 200]);
    expect(parseTemperatureTicks('100.5, 180.25', 'C')).toEqual([100.5, 180.25]);
    expect(parseTemperatureTicks('', 'C')).toEqual([]);
    for (const invalid of [
        '[]',
        '[100, 150, 180]',
        '20 30',
        '100; 180',
        '[100',
        '["100"]',
        '100, nope',
        '100,',
        ',100',
        'NaN',
        'Infinity',
        '-1',
        '501',
        Array(101).fill(100).join(','),
    ]) {
        expect(parseTemperatureTicks(invalid, 'C')).toBeNull();
    }
});

describe('formatTemp (History/profile/compare display)', () => {
    it('returns em dash for null', () => {
        expect(formatTemp(null, 'C')).toBe('—');
        expect(formatTemp(null, 'F')).toBe('—');
    });

    it('keeps Celsius and converts Fahrenheit', () => {
        expect(formatTemp(200, 'C')).toBe('200.0°C');
        expect(formatTemp(200, 'F')).toBe('392.0°F');
        expect(formatTemp(205, 'F')).toBe('401.0°F');
    });
});

describe('toDisplayTemp / toDisplayRoR', () => {
    it('converts absolute temps and rate deltas', () => {
        expect(toDisplayTemp(205, 'C')).toBe(205);
        expect(toDisplayTemp(205, 'F')).toBe(401);
        expect(toDisplayRoR(10, 'C')).toBe(10);
        expect(toDisplayRoR(10, 'F')).toBe(18);
        expect(fromDisplayRoR(18, 'F')).toBe(10);
        expect(fromDisplayRoR(-9, 'F')).toBe(-5);
        expect(parseRorTicks('10, -5, 0, 0', 'C')).toEqual([-5, 0, 10]);
        expect(parseRorTicks('-9, 18', 'F')).toEqual([-5, 10]);
        expect(parseRorTicks('301', 'C')).toBeNull();
        expect(parseRorTicks('', 'C')).toEqual([]);
        expect(fromDisplayTemp(401, 'F')).toBeCloseTo(205);
    });
});

describe('unit labels', () => {
    it('uses °C/°F not single-glyph ℃/℉', () => {
        expect(tempUnitLabel('C')).toBe('°C');
        expect(tempUnitLabel('F')).toBe('°F');
        expect(rorUnitLabel('C')).toBe('°C/min');
        expect(rorUnitLabel('F')).toBe('°F/min');
    });
});
