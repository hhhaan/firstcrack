import { expect, it } from 'vitest';
import { livePointsFromBbp } from './bbp-live-points';

it('maps BBP samples to positive End-relative time without RoR', () => {
    const rows = livePointsFromBbp([
        {
            t: 1,
            bt: 210,
            et: 200,
            heater: 50,
            fan: 1234.56,
            drum: 31.25,
            processing: {
                read_units: { heater: '%', fan: 'Pa', drum: 'Hz' },
                algorithm_version: 'test',
                temperature_unit: 'C',
                ror_unit: 'C/min',
                timestamp_clock: 'sidecar-monotonic-seconds',
                display_ema_alpha: 1,
                ror_ema_alpha: 1,
                ror_window_sec: 30,
                ror_warmup_reads: 0,
            },
        },
        { t: 65, bt: 188, et: 195, heater: null, fan: 40, drum: 60 },
    ]);
    expect(rows.map((p) => [p.time, p.label])).toEqual([
        [1, '0:01'],
        [65, '1:05'],
    ]);
    expect(rows.every((p) => p.ror === null)).toBe(true);
    expect(rows[0].processing?.read_units).toEqual({ heater: '%', fan: 'Pa', drum: 'Hz' });
    expect(rows[0].fan).toBe(1234.56);
});
