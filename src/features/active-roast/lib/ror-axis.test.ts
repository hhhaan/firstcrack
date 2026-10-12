import { describe, expect, it } from 'vitest';
import { parseRorAxis } from './ror-axis';

describe('RoR axis edits', () => {
    it('converts Fahrenheit deltas without an absolute temperature offset', () => {
        expect(parseRorAxis('-9', '36', '9', 'F')).toEqual({ rorYMin: -5, rorYMax: 20, rorGridInterval: 5 });
    });
    it.each([
        ['', '20', '5'],
        ['20', '20', '5'],
        ['30', '20', '5'],
        ['-5', '20', '0'],
        ['-5', '20', '-1'],
        ['NaN', '20', '5'],
        ['-5', 'Infinity', '5'],
        ['-101', '20', '5'],
        ['0', '301', '5'],
    ])('rejects invalid edits %s/%s/%s', (min, max, interval) => {
        expect(parseRorAxis(min, max, interval, 'C')).toBeNull();
    });
});
