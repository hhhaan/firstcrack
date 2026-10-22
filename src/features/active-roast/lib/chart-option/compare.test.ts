import { toDisplayRoR, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CURVE_STYLES } from '../curve-style';
import {
    buildCompareChartOption,
    type CompareChartSeries,
    compareBatchColor,
    compareChartRightMargin,
} from './compare';
import { compareChannels } from './compare-channels';

const series: CompareChartSeries[] = [
    {
        id: 'a',
        label: 'A',
        batchIndex: 0,
        points: [{ t: 0, bt: 200, et: 210, ror: 10 }],
    },
];

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('buildCompareChartOption display unit', () => {
    it('keeps a stable color and marker for each batch when others are hidden', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const batches = Array.from({ length: 5 }, (_, batchIndex) => ({
            ...series[0],
            id: `batch-${batchIndex}`,
            batchIndex,
        }));
        const curveStyles = {
            ...DEFAULT_CURVE_STYLES,
            bt: { ...DEFAULT_CURVE_STYLES.bt, color: '#873d72' },
        };
        const option = buildCompareChartOption(batches, {
            xView: { start: 0, end: 60 },
            channelKeys: ['bt'],
            curveStyles,
        });
        expect(option.series).toMatchObject(
            [0, 1, 2, 3, 4].map((index) => ({
                showSymbol: false,
                lineStyle: { color: compareBatchColor(index), type: 'solid' },
                endLabel: { show: false },
                data: [[0, 200]],
            })),
        );
        const hidden = buildCompareChartOption([batches[1], batches[3]], {
            xView: { start: 0, end: 60 },
            channelKeys: ['bt'],
            curveStyles,
        });
        expect(hidden.series).toMatchObject(
            [1, 3].map((index) => ({
                showSymbol: false,
                lineStyle: { color: compareBatchColor(index), type: 'solid' },
                endLabel: { show: false },
                data: [[0, 200]],
            })),
        );
    });

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
        const option = buildCompareChartOption(input, { xView: { start: 0, end: 60 }, temperatureUnit: 'F' });
        const curves = option.series as {
            name: string;
            yAxisIndex: number;
            data: [number, number | null][];
            lineStyle: { type: string };
        }[];
        expect(curves.map((curve) => curve.lineStyle.type)).toEqual([
            'solid',
            'solid',
            'solid',
            'solid',
            'solid',
            'solid',
        ]);
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
        const selected = buildCompareChartOption(input, { xView: { start: 0, end: 60 }, channelKeys: ['bt'] });
        expect((selected.series as { name: string }[]).map((s) => s.name)).toEqual(['bt|a']);
        expect(selected.yAxis).toHaveLength(1);
    });

    it('does not synthesize ET RoR or missing extra sensor data for legacy sessions', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const option = buildCompareChartOption(series, { xView: { start: 0, end: 60 } });
        expect((option.series as { name: string }[]).map((s) => s.name)).toEqual(['bt|a', 'et|a', 'ror|a']);
    });

    it('compares one sensor on its own axis with full-contrast curves', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));

        const rorOption = buildCompareChartOption(series, {
            xView: { start: 0, end: 60 },
            temperatureUnit: 'F',
            channelKeys: ['ror'],
        });
        expect(rorOption.yAxis).toMatchObject([{ name: '°F/min', position: 'left' }]);
        expect(rorOption.yAxis).toHaveLength(1);
        const rateAxis = Array.isArray(rorOption.yAxis) ? rorOption.yAxis[0] : rorOption.yAxis;
        expect(rateAxis?.min).toBeUndefined();
        expect(rateAxis?.max).toBeUndefined();
        expect(rorOption.series).toMatchObject([
            {
                name: 'ror|a',
                yAxisIndex: 0,
                lineStyle: { width: 2, type: 'solid', opacity: 1 },
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
        const option = buildCompareChartOption(input, {
            xView: { start: 0, end: 60 },
            channelKeys: [pressure?.key ?? ''],
        });
        expect(option.yAxis).toMatchObject([{ name: 'Pa', position: 'left', scale: true }]);
        expect(option.yAxis).toHaveLength(1);
        expect(option.series).toMatchObject([{ yAxisIndex: 0, data: [[0, 0]] }]);
    });

    it('plots BT/RoR via toDisplayTemp/toDisplayRoR', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));

        const option = buildCompareChartOption(series, { xView: { start: 0, end: 60 }, temperatureUnit: 'F' });
        const seriesOpt = option.series as { name?: string; data: [number, number][] }[];
        const bt = seriesOpt.find((s) => s.name?.startsWith('bt|'));
        const ror = seriesOpt.find((s) => s.name?.startsWith('ror|'));

        expect(bt?.data[0]?.[1]).toBe(toDisplayTemp(200, 'F'));
        expect(ror?.data[0]?.[1]).toBe(toDisplayRoR(10, 'F'));
    });

    it('uses one rate axis and solid lines when only BT and ET RoR are selected', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const input = [{ ...series[0], points: [{ ...series[0].points[0], rorEt: 4 }] }];
        const option = buildCompareChartOption(input, {
            xView: { start: 0, end: 60 },
            temperatureUnit: 'F',
            channelKeys: ['ror', 'rorEt'],
        });
        expect(option.yAxis).toHaveLength(1);
        expect(option.grid).toMatchObject([{ right: 56 }]);
        expect(option.yAxis).toMatchObject([{ name: '°F/min', position: 'left' }]);
        expect(option.series).toMatchObject([
            { name: 'ror|a', yAxisIndex: 0, lineStyle: { type: 'solid' }, data: [[0, 18]] },
            { name: 'rorEt|a', yAxisIndex: 0, lineStyle: { type: 'solid' }, data: [[0, 7.2]] },
        ]);
    });

    it('brings the focused batch above overlapping curves without changing their data', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const input = [series[0], { ...series[0], id: 'b', batchIndex: 1 }];
        const option = buildCompareChartOption(input, {
            xView: { start: 0, end: 60 },
            channelKeys: ['bt'],
            focusedSessionId: 'a',
        });
        expect(option.series).toMatchObject([
            { z: 5, lineStyle: { width: 4, opacity: 1 }, data: [[0, 200]] },
            { z: 2, lineStyle: { width: 2, opacity: 0.15 }, data: [[0, 200]] },
        ]);
    });

    it('aligns the Gas step plot with the temperature plot without normalizing physical commands', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        for (const unit of ['%', 'Pa']) {
            const input = [{ ...series[0], points: [{ ...series[0].points[0], heaterSet: 0, heaterUnit: unit }] }];
            const channel = compareChannels(input, 'C').find((c) => c.source === 'heaterSet');
            const option = buildCompareChartOption(input, {
                xView: { start: 0, end: 60 },
                channelKeys: [channel?.key ?? ''],
                rightMargin: 32,
            });
            expect(option.grid).toMatchObject([{ right: 32 }]);
            expect(option.series).toMatchObject([{ step: 'end', yAxisIndex: 0, data: [[0, 0]] }]);
            expect(option.yAxis).toMatchObject([{ name: unit, ...(unit === '%' ? { min: 0, max: 100 } : {}) }]);
            if (unit === 'Pa') expect((option.yAxis as { max?: number }[])[0].max).toBeUndefined();
        }
    });

    it('aligns a percent-and-rpm control chart with the temperature plot', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
        const input: CompareChartSeries[] = [
            {
                ...series[0],
                points: [
                    { t: 0, bt: 180, et: 190, ror: -70, heaterSet: 80, heaterUnit: '%', drum: 45, drumUnit: 'RPM' },
                ],
            },
        ];
        const channels = compareChannels(input, 'C');
        const temp = buildCompareChartOption(input, { xView: { start: 0, end: 60 }, channelKeys: ['bt', 'ror'] });
        const control = buildCompareChartOption(input, {
            xView: { start: 0, end: 60 },
            channelKeys: channels.filter((channel) => channel.kind === 'other').map((channel) => channel.key),
        });
        const tempGrid = (temp.grid as { left: number; right: number }[])[0];
        const controlGrid = (control.grid as { left: number; right: number }[])[0];
        expect(controlGrid).toMatchObject({ left: tempGrid.left, right: tempGrid.right });
        expect(compareChartRightMargin(channels.filter((channel) => channel.kind === 'other'))).toBe(
            compareChartRightMargin(channels.filter((channel) => channel.key === 'bt' || channel.key === 'ror')),
        );
        expect(control.yAxis).toMatchObject([
            { name: '%', position: 'left', min: 0, max: 100 },
            { name: 'RPM', position: 'right' },
        ]);
        const rorAxis = (temp.yAxis as { min?: number; max?: number; position?: string }[]).find(
            (axis) => axis.position === 'right',
        );
        expect(rorAxis?.min).toBe(-5);
        expect(rorAxis?.max).toBe(20);
    });

    it('keeps channel colors while resolving read-only marker categories', () => {
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
            { xView: { start: 0, end: 60 }, channelKeys: ['bt', 'et'] },
        );
        const [bt] = option.series as {
            lineStyle: { color: string };
            showSymbol: boolean;
            markPoint?: unknown;
        }[];
        expect(bt.lineStyle.color).toBe(compareBatchColor(0));
        expect(bt.showSymbol).toBe(false);
        expect(bt.markPoint).toBeUndefined();
    });
});
