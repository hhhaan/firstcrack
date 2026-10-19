import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCompareChartOption, type CompareChartSeries } from './compare';
import { compareChannels } from './compare-channels';

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
    it('compares recorded ET, ET RoR and extra sensors with separate units and gaps', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const input: CompareChartSeries[] = [
            {
                ...series[0],
                label: '<batch>',
                points: [
                    {
                        t: 0,
                        bt: 190,
                        et: 210,
                        ror: 5,
                        rorEt: 3,
                        extraReadings: [
                            { id: 'inlet', label: 'Inlet', unit: 'C', value: 220 },
                            { id: 'pressure', label: '<pressure>', unit: 'Pa', value: 0 },
                        ],
                    },
                    { t: 1, bt: 191, et: null, ror: null, rorEt: null },
                    {
                        t: 2,
                        bt: 192,
                        et: 212,
                        ror: 4,
                        rorEt: 2,
                        extraReadings: [{ id: 'pressure', label: '<pressure>', unit: 'Pa', value: 12 }],
                    },
                ],
            },
        ];
        const option = buildCompareChartOption(input, true, { start: 0, end: 60 }, 'F');
        const curves = option.series as { name: string; yAxisIndex: number; data: [number, number | null][] }[];
        expect(curves.find((s) => s.name === 'et|a')?.data).toEqual([
            [0, 410],
            [1, null],
            [2, 413.6],
        ]);
        expect(curves.find((s) => s.name === 'rorEt|a')?.data).toEqual([
            [0, 5.4],
            [1, null],
            [2, 3.6],
        ]);
        const pressure = curves.find((s) => s.name.includes('pressure'));
        expect(pressure?.data).toEqual([
            [0, 0],
            [1, null],
            [2, 12],
        ]);
        expect((option.yAxis as { name?: string }[])[pressure?.yAxisIndex ?? -1]?.name).toBe('Pa');
        expect(curves.find((s) => s.name.includes('inlet'))?.data).toEqual([
            [0, 428],
            [1, null],
            [2, null],
        ]);
        const tooltip = (option.tooltip as { formatter: (params: unknown) => string }).formatter([
            { seriesName: pressure?.name, axisValue: 0, value: [0, 0] },
        ]);
        expect(tooltip).toContain('&lt;batch&gt;');
        expect(tooltip).toContain('&lt;pressure&gt;');
        expect(tooltip).toContain('0.0Pa');
        const selected = buildCompareChartOption(input, true, { start: 0, end: 60 }, 'C', ['bt']);
        expect((selected.series as { name: string }[]).map((s) => s.name)).toEqual(['bt|a']);
        expect(selected.yAxis).toHaveLength(1);
    });

    it('does not synthesize ET RoR or missing extra sensor data for legacy sessions', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const option = buildCompareChartOption(series, true, { start: 0, end: 60 });
        expect((option.series as { name: string }[]).map((s) => s.name)).toEqual(['bt|a', 'et|a', 'ror|a']);
    });

    it('compares one sensor on its own axis with full-contrast curves and batch end labels', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));

        const rorOption = buildCompareChartOption(series, true, { start: 0, end: 60 }, 'F', ['ror']);
        expect(rorOption.yAxis).toMatchObject([{ name: '°F/min', position: 'left' }]);
        expect(rorOption.yAxis).toHaveLength(1);
        expect(rorOption.series).toMatchObject([
            {
                name: 'ror|a',
                yAxisIndex: 0,
                lineStyle: { width: 3, type: 'solid', opacity: 1 },
                endLabel: { show: true, fontSize: 13 },
                data: [[0, toDisplayRoR(10, 'F')]],
            },
        ]);

        const input: CompareChartSeries[] = [
            {
                ...series[0],
                points: [
                    {
                        ...series[0].points[0],
                        extraReadings: [{ id: 'pressure', label: 'Pressure', unit: 'Pa', value: 0 }],
                    },
                ],
            },
        ];
        const pressure = compareChannels(input, 'C').find((channel) => channel.source === 'extra');
        expect(pressure).toBeDefined();
        const option = buildCompareChartOption(input, true, { start: 0, end: 60 }, 'C', [pressure?.key ?? '']);
        expect(option.yAxis).toMatchObject([{ name: 'Pa', position: 'left', scale: true }]);
        expect(option.yAxis).toHaveLength(1);
        expect(option.series).toMatchObject([{ yAxisIndex: 0, data: [[0, 0]] }]);
    });

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

    it('keeps a batch line pattern when other batches are hidden', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const batch = { ...series[0], lineDash: [10, 5] };
        const option = buildCompareChartOption([batch], true, { start: 0, end: 60 }, 'C', ['bt']);
        expect(option.series).toMatchObject([{ lineStyle: { type: [10, 5], opacity: 1 } }]);
    });

    it('brings the focused batch above overlapping curves without changing their data', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const input = [series[0], { ...series[0], id: 'b' }];
        const option = buildCompareChartOption(input, true, { start: 0, end: 60 }, 'C', ['bt'], 'a');
        expect(option.series).toMatchObject([
            { z: 5, lineStyle: { width: 4, opacity: 1 }, endLabel: { opacity: 1 }, data: [[0, 200]] },
            { z: 2, lineStyle: { width: 3, opacity: 0.15 }, endLabel: { opacity: 0.3 }, data: [[0, 200]] },
        ]);
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
