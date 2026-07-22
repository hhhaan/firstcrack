import { describe, expect, it } from 'vitest';
import { parseTsv } from './tsv';

const HEADER = 'time\tbt\tet\tror\theater\tfan\tdrum';

describe('parseTsv', () => {
    it('skips header and parses finite t/bt with optional et/ror', () => {
        const text = [HEADER, '0\t180.5\t200\t5.2\t50\t30\t0', '1.5\t185\t205.1\t4.0\t50\t30\t0', ''].join('\n');
        expect(parseTsv(text)).toEqual([
            { t: 0, bt: 180.5, et: 200, ror: 5.2 },
            { t: 1.5, bt: 185, et: 205.1, ror: 4 },
        ]);
    });

    it('nulls et/ror when missing or non-finite', () => {
        const text = [HEADER, '0\t100', '1\t110\t', '2\t120\tnan\tinf', '3\t130\t150\t', '4\t140\t160\t3.5'].join('\n');
        expect(parseTsv(text)).toEqual([
            { t: 0, bt: 100, et: null, ror: null },
            { t: 1, bt: 110, et: null, ror: null },
            { t: 2, bt: 120, et: null, ror: null },
            { t: 3, bt: 130, et: 150, ror: null },
            { t: 4, bt: 140, et: 160, ror: 3.5 },
        ]);
    });

    it('drops rows with non-finite t or bt, short rows, and empty lines', () => {
        const text = [HEADER, '', 'onlyone', 'x\t100', '1\ty', 'NaN\t100', '2\tNaN', '3\t150\t160\t2'].join('\n');
        expect(parseTsv(text)).toEqual([{ t: 3, bt: 150, et: 160, ror: 2 }]);
    });

    it('returns empty array for header-only or empty input', () => {
        expect(parseTsv(HEADER)).toEqual([]);
        expect(parseTsv('')).toEqual([]);
    });
});
