import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCompareChartOption, type CompareChartSeries } from './compare';

const series: CompareChartSeries[] = [
    {
        id: 'a',
        label: 'A',
        color: '#000',
        points: [{ t: 0, bt: 200, et: 210, ror: 10 }],
    },
];

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('buildCompareChartOption display unit', () => {
    it('plots BT/RoR via toDisplayTemp/toDisplayRoR', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));

        const option = buildCompareChartOption(series, true, { start: 0, end: 60 }, 'F');
        const seriesOpt = option.series as { name?: string; data: [number, number][] }[];
        const bt = seriesOpt.find((s) => s.name?.startsWith('bt|'));
        const ror = seriesOpt.find((s) => s.name?.startsWith('ror|'));

        expect(bt?.data[0]?.[1]).toBe(toDisplayTemp(200, 'F'));
        expect(ror?.data[0]?.[1]).toBe(toDisplayRoR(10, 'F'));
    });

    it('keeps session curve colors while resolving read-only marker categories', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({
            getPropertyValue: (token: string) =>
                token === '--color-event-control' ? '#red' : token === '--color-event-mark' ? '#gray' : '',
        }));

        const option = buildCompareChartOption(
            [
                {
                    ...series[0],
                    markers: [
                        { timeSec: 0, event: 'Note' },
                        { timeSec: 0, event: 'Heater' },
                    ],
                },
            ],
            false,
            { start: 0, end: 60 },
        );
        const [bt] = option.series as {
            lineStyle: { color: string };
            markPoint: { data: { itemStyle: { color: string } }[] };
        }[];
        expect(bt.lineStyle.color).toBe('#000');
        expect(bt.markPoint.data.map((marker) => marker.itemStyle.color)).toEqual(['#gray', '#red']);
    });
});
