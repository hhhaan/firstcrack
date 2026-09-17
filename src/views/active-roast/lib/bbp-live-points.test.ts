import { describe, expect, it } from 'vitest';
import { livePointsFromBbp } from './bbp-live-points';

describe('livePointsFromBbp', () => {
    it('keeps collected samples before Charge on the same timeline', () => {
        const rows = livePointsFromBbp(
            [
                { t: 1, bt: 210, et: 200, heater: 50, fan: 40, drum: 60 },
                { t: 65, bt: 188, et: 195, heater: null, fan: 40, drum: 60 },
            ],
            92,
        );
        expect(rows.map((p) => [p.time, p.label])).toEqual([
            [-91, '-1:31'],
            [-27, '-0:27'],
        ]);
        expect(rows.every((p) => p.ror === null)).toBe(true);
    });
    it('maps BBP points onto live chart rows with End-relative time', () => {
        const rows = livePointsFromBbp([
            { t: 1, bt: 210, et: 200, heater: 50, fan: 40, drum: 60 },
            { t: 65, bt: 188, et: 195, heater: null, fan: 40, drum: 60 },
        ]);
        expect(rows).toEqual([
            {
                time: 1,
                label: '0:01',
                bt: 210,
                et: 200,
                ror: null,
                ror_et: null,
                heater: 50,
                fan: 40,
                drum: 60,
            },
            {
                time: 65,
                label: '1:05',
                bt: 188,
                et: 195,
                ror: null,
                ror_et: null,
                heater: null,
                fan: 40,
                drum: 60,
            },
        ]);
    });
});
