import { describe, expect, it } from 'vitest';
import type { LiveRoastPoint } from '../model/useSidecarPolling';
import { buildLiveChartData, CHART_TOTAL_SECS } from './chart-pipeline-data';

const pt = (time: number, bt = 100): LiveRoastPoint => ({
    time,
    label: '0:00',
    bt,
    et: 110,
    ror: 5,
    ror_et: 4,
    heater: 50,
    fan: 30,
    drum: 40,
});

describe('buildLiveChartData', () => {
    it('maps live points without a btTarget field (target is a separate series)', () => {
        const rows = buildLiveChartData([pt(0), pt(1)], 60, 0);
        const mid = rows.find((r) => r.time === 0);
        expect(mid).toMatchObject({
            time: 0,
            btActual: 100,
            etActual: 110,
            rorActual: 5,
            etRorActual: 4,
        });
        expect(mid).not.toHaveProperty('btTarget');
    });

    it('dedupes points that round to the same centisecond', () => {
        const rows = buildLiveChartData([pt(1.001, 100), pt(1.004, 200)], 0, 0);
        const live = rows.filter((r) => r.btActual != null);
        expect(live).toHaveLength(1);
        expect(live[0].btActual).toBe(100);
    });

    it('adds start/end sentinels for axis extent', () => {
        const rows = buildLiveChartData([pt(10)], 30, 0);
        expect(rows[0]).toEqual({
            time: -30,
            btActual: null,
            etActual: null,
            rorActual: null,
            etRorActual: null,
        });
        expect(rows[rows.length - 1].time).toBe(CHART_TOTAL_SECS);
        expect(rows[rows.length - 1].btActual).toBeNull();
    });

    it('sorts only when live points arrive out of order', () => {
        const rows = buildLiveChartData([pt(5), pt(1), pt(3)], 0, 0);
        const times = rows.filter((r) => r.btActual != null).map((r) => r.time);
        expect(times).toEqual([1, 3, 5]);
    });

    it('extends end sentinel past long profiles and long live sessions', () => {
        const rows = buildLiveChartData([pt(900)], 0, 850);
        expect(rows[rows.length - 1].time).toBe(900);
    });
});
