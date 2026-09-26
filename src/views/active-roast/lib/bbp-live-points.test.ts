import { expect, it } from 'vitest';
import { livePointsFromBbp } from './bbp-live-points';

it('maps BBP samples to positive End-relative time without RoR', () => {
    const rows = livePointsFromBbp([
        { t: 1, bt: 210, et: 200, heater: 50, fan: 40, drum: 60 },
        { t: 65, bt: 188, et: 195, heater: null, fan: 40, drum: 60 },
    ]);
    expect(rows.map((p) => [p.time, p.label])).toEqual([
        [1, '0:01'],
        [65, '1:05'],
    ]);
    expect(rows.every((p) => p.ror === null)).toBe(true);
});
