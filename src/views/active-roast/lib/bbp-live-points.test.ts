import { describe, expect, it } from 'vitest';
import { livePointsFromBbp } from './bbp-live-points';

describe('livePointsFromBbp', () => {
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
