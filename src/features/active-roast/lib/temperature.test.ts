import { describe, expect, it } from 'vitest';
import {
    formatRecordedTemp,
    formatTemp,
    fromDisplayTemp,
    rorUnitLabel,
    tempUnitLabel,
    toDisplayRoR,
    toDisplayTemp,
} from './temperature';

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

    it('rounds recorded °C before converting, so 205.4 is 205°C and 401°F', () => {
        expect(formatRecordedTemp(null, 'C')).toBe('—');
        expect(formatRecordedTemp(205.4, 'C')).toBe('205°C');
        expect(formatRecordedTemp(205.4, 'F')).toBe('401°F');
        expect(formatRecordedTemp(180.6, 'C')).toBe('181°C');
    });
});

describe('toDisplayTemp / toDisplayRoR', () => {
    it('converts absolute temps and rate deltas', () => {
        expect(toDisplayTemp(205, 'C')).toBe(205);
        expect(toDisplayTemp(205, 'F')).toBe(401);
        expect(toDisplayRoR(10, 'C')).toBe(10);
        expect(toDisplayRoR(10, 'F')).toBe(18);
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
