import {
    CONTROL_CURVE_WIDTH,
    EVENT_MARK_LINE_WIDTH,
    MARKER_LABEL_FONT,
    markerLabelFont,
    TEMP_CURVE_WIDTH,
} from '@features/active-roast/lib/chart-config';
import * as echarts from 'echarts';
import { describe, expect, it, vi } from 'vitest';
import { mockChartColors as mockColors } from './chart-colors.fixture';
import { buildRoastChartOption } from './index';
import type { ChartOptionParams } from './types';

const baseParams = (): ChartOptionParams => ({
    xs: [],
    btTarget: [],
    btActual: [],
    etActual: [],
    rorActual: [],
    currentTimeSec: 0,
    charged: false,
    eventMarkerStyle: 'point',
    eventMarkers: [],
    turningPoints: [],
    temperatureUnit: 'C',
    showET: true,
    showTargetCurve: true,
    showRoR: true,
    showRoRET: false,
    rorEtActual: [],
    showControlDrum: true,
    showControlHeat: true,
    showControlFan: true,
    controlChartHeightPct: 21,
    controlYMin: 0,
    controlYMax: 100,
    phaseSegments: [],
    tempMinC: 50,
    tempMaxC: 250,
    rorYMin: -5,
    rorYMax: 20,
    colors: mockColors,
});

describe('buildRoastChartOption font scale', () => {
    it.each([1, 1.01, 1.13, 1.25, 1.5, 1.75, 1.99, 2])(
        'scales chart labels by %s without moving the axes',
        (fontScale) => {
            const option = buildRoastChartOption({
                ...baseParams(),
                fontScale,
                bbpRange: { start: 0, end: 60, label: 'PREHEAT' },
            });
            const yAxis = option.yAxis as { axisLabel?: { fontSize?: number } }[];
            expect(yAxis[0]?.axisLabel?.fontSize).toBe(11);
            expect(option.grid).toMatchObject([{ left: 38, right: 32, bottom: 65 }]);
            const bbp = (option.series as { markArea?: { label?: { fontSize?: number } } }[])[0];
            expect(bbp?.markArea?.label?.fontSize).toBe(12 * fontScale);
            expect(markerLabelFont(fontScale)).toBe(`600 ${10 * fontScale}px monospace`);
        },
    );
});

describe('buildRoastChartOption', () => {
    it('uses native custom temperature ticks and clears them when returning to a custom interval', () => {
        for (const temperatureUnit of ['C', 'F'] as const) {
            for (const controls of [false, true]) {
                const params = {
                    ...baseParams(),
                    temperatureUnit,
                    controlData: controls
                        ? { xs: [0, 120], drumTemp: [50, 50], heatPower: [80, 40], fanSpeed: [30, 40] }
                        : undefined,
                };
                const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 400 });
                try {
                    const custom = buildRoastChartOption({
                        ...params,
                        axisSettings: {
                            tempGridInterval: 15,
                            tempLabelEvery: 5,
                            timeTickIntervalSec: 60,
                            tempTicksC: [100, 181.5, 210],
                        },
                    });
                    chart.setOption(custom);
                    const axis = (
                        custom.yAxis as {
                            axisTick: { customValues: number[] };
                            axisLabel: { customValues: number[]; formatter: (value: number) => string };
                        }[]
                    )[0];
                    const expected = temperatureUnit === 'C' ? [100, 181.5, 210] : [212, 358.7, 410];
                    expect(axis.axisTick.customValues).toEqual(expected);
                    expect(axis.axisLabel.customValues).toEqual(expected);
                    expect(axis.axisLabel.formatter(expected[1])).toBe(String(expected[1]));
                    const restored = buildRoastChartOption({
                        ...params,
                        axisSettings: {
                            tempGridInterval: 2.5,
                            tempLabelEvery: 1,
                            timeTickIntervalSec: 60,
                            tempTicksC: [],
                        },
                    });
                    chart.setOption(restored);
                    const reset = (
                        chart.getOption().yAxis as {
                            interval: number;
                            axisTick: { customValues?: number[] };
                            axisLabel: { customValues?: number[] };
                        }[]
                    )[0];
                    expect(reset.interval).toBe(2.5);
                    expect(reset.axisTick.customValues).toBeUndefined();
                    expect(reset.axisLabel.customValues).toBeUndefined();
                    expect(
                        (
                            restored.yAxis as { axisLabel: { formatter: (value: number) => string } }[]
                        )[0].axisLabel.formatter(102.5),
                    ).toBe('102.5');
                } finally {
                    chart.dispose();
                }
            }
        }
    });

    it('applies display-unit grid and label intervals to both layouts and report charts', () => {
        for (const temperatureUnit of ['C', 'F'] as const) {
            for (const controls of [false, true]) {
                for (const report of [false, true]) {
                    const params = {
                        ...baseParams(),
                        xs: [0, 30, 60],
                        btActual: [100, 110, 120],
                        tempMinC: 133,
                        tempMaxC: 237,
                        eventMarkers: [
                            { timeSec: 30, event: 'Note', color: '#888', timeStr: '', temp: '', note: 'Top' },
                        ],
                        temperatureUnit,
                        report,
                        controlData: controls
                            ? { xs: [0, 120], drumTemp: [50, 50], heatPower: [80, 40], fanSpeed: [30, 40] }
                            : undefined,
                    };
                    const configured = buildRoastChartOption({
                        ...params,
                        axisSettings: { tempGridInterval: 25, tempLabelEvery: 2, timeTickIntervalSec: 30 },
                    });
                    expect(configured.xAxis).toEqual(
                        expect.arrayContaining([expect.objectContaining({ interval: 30 })]),
                    );
                    for (const axis of configured.xAxis as { interval: number }[]) expect(axis.interval).toBe(30);
                    const axis = (
                        configured.yAxis as {
                            interval: number;
                            min: number;
                            max: number;
                            axisLabel: { formatter: (value: number) => string; hideOverlap: boolean };
                        }[]
                    )[0];
                    expect(axis.interval).toBe(25);
                    expect(axis.min % 25).toBe(0);
                    expect(axis.max % 25).toBe(0);
                    expect(axis.axisLabel.formatter(100)).toBe('100');
                    expect(axis.axisLabel.formatter(125)).toBe('');
                    expect(axis.axisLabel.hideOverlap).toBe(true);
                    expect([axis.min, axis.max]).toEqual(temperatureUnit === 'C' ? [125, 250] : [250, 475]);
                    const coord = vi.fn(() => [50, 10]);
                    const labels = (
                        configured.series as { id?: string; renderItem?: (params: unknown, api: unknown) => unknown }[]
                    ).find((series) => series.id === 'event-curve-labels');
                    labels?.renderItem?.(
                        { dataIndex: 0, coordSys: { x: 0, y: 0, width: 300, height: 300 } },
                        { coord, getWidth: () => 300 },
                    );
                    expect(coord).toHaveBeenCalledWith([30, axis.max]);
                    const defaults = buildRoastChartOption({
                        ...params,
                        axisSettings: { tempGridInterval: 10, tempLabelEvery: 5, timeTickIntervalSec: 60 },
                    });
                    expect((defaults.yAxis as { interval: number }[])[0].interval).toBe(10);
                    expect((defaults.xAxis as { interval: number }[])[0].interval).toBe(60);
                    const labelsDefault = (
                        defaults.yAxis as { axisLabel: { formatter: (value: number) => string } }[]
                    )[0].axisLabel;
                    expect(labelsDefault.formatter(150)).toBe('150');
                    expect(labelsDefault.formatter(160)).toBe('');
                }
            }
        }
    });

    it('keeps useful time and temperature ticks on a short report', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            report: true,
            xViewMax: 11,
            tempMinC: 180,
            tempMaxC: 200,
        });
        expect(option.xAxis).toEqual(expect.arrayContaining([expect.objectContaining({ interval: 5 })]));
        expect(option.yAxis).toEqual(
            expect.arrayContaining([expect.objectContaining({ interval: 10, min: 180, max: 200 })]),
        );
    });

    it('simplifies report axes in both layouts without changing recorded samples or instrument defaults', () => {
        for (const temperatureUnit of ['C', 'F'] as const) {
            for (const controls of [false, true]) {
                const params = {
                    ...baseParams(),
                    temperatureUnit,
                    tempMinC: 93,
                    tempMaxC: 217,
                    xs: [0, 60, 120],
                    btActual: [200, null, 150],
                    controlData: controls
                        ? { xs: [0, 120], drumTemp: [50, 50], heatPower: [80, 40], fanSpeed: [30, 40] }
                        : undefined,
                };
                const report = buildRoastChartOption({ ...params, report: true });
                const instrument = buildRoastChartOption(params);
                expect(report.xAxis).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            axisLine: { show: false },
                            splitLine: { show: false },
                            minorSplitLine: { show: false },
                        }),
                    ]),
                );
                expect(report.yAxis).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ interval: 50, splitLine: expect.objectContaining({ show: true }) }),
                        expect.objectContaining({ position: 'right', interval: temperatureUnit === 'F' ? 10 : 5 }),
                    ]),
                );
                const tempAxis = (report.yAxis as { min: number; max: number }[])[0];
                expect(tempAxis.min % 50).toBe(0);
                expect(tempAxis.max % 50).toBe(0);
                const samples = (option: typeof report) =>
                    (option.series as { name?: string; data: unknown }[]).find((series) => series.name === 'BT Actual')
                        ?.data;
                expect(samples(report)).toEqual([
                    [0, 200],
                    [60, null],
                    [120, 150],
                ]);
                expect(samples(report)).toEqual(samples(instrument));
                expect(instrument.xAxis).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ minorSplitLine: expect.objectContaining({ show: true }) }),
                    ]),
                );
            }
        }
    });

    it('shades only the visible BBP interval on both grids without shifting Charge', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [-92, -2, 0, 60],
            btActual: [210, 195, 195, 155],
            etActual: [220, 215, 215, 210],
            rorActual: [null, null, 0, 5],
            bbpRange: { start: -92, end: 0 },
            xViewMin: -60,
            xViewMax: 60,
            controlData: { xs: [-92, 0, 60], drumTemp: [50, 50, 50], heatPower: [20, 50, 45], fanSpeed: [30, 30, 30] },
        });
        const series = option.series as {
            id?: string;
            name?: string;
            xAxisIndex: number;
            data: unknown;
            markArea?: { data: unknown; itemStyle: unknown };
        }[];
        const backgrounds = series.filter((s) => s.id?.startsWith('bbp-'));
        expect(backgrounds.map((s) => s.xAxisIndex)).toEqual([0, 1]);
        const axes = option.xAxis as { min: number; max: number }[];
        expect(axes.map((axis) => [axis.min, axis.max])).toEqual([
            [-60, 60],
            [-60, 60],
        ]);
        for (const s of backgrounds) {
            expect(s.markArea?.data).toEqual([[{ name: 'BBP', xAxis: -60 }, { xAxis: 0 }]]);
            expect(s.markArea?.itemStyle).toEqual({ color: mockColors.bbpFill });
        }
        expect(series.find((s) => s.name === 'BT Actual')?.data).toEqual([
            [-92, 210],
            [-2, 195],
            [0, 195],
            [60, 155],
        ]);
        const roastOnly = buildRoastChartOption({ ...baseParams(), bbpRange: { start: -92, end: 0 }, xViewMin: 0 });
        expect((roastOnly.series as typeof series).find((s) => s.id === 'bbp-background')?.markArea?.data).toEqual([]);
    });
    it('builds single-grid option for empty data', () => {
        const option = buildRoastChartOption(baseParams());
        const series = option.series as unknown[];
        const yAxis = option.yAxis as unknown[];

        // BT Actual, ET, RoR, and the always-on event label series (clears stale zoom labels).
        expect(series).toHaveLength(4);
        expect(yAxis).toHaveLength(2);
        expect(option.grid).toHaveLength(1);
        expect(option.dataZoom).toEqual([]);
    });

    it('hides axis tooltip past the last drawn sample when target continues', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [0, 71, 900],
            btActual: [195, 210, null],
            etActual: [200, 215, null],
            rorActual: [null, 4, null],
            targetXs: [0, 71, 120],
            targetBt: [195, 210.1, 210],
            charged: false,
            currentTimeSec: 71,
            controlData: {
                xs: [0, 71],
                drumTemp: [50, 50],
                heatPower: [20, 20],
                fanSpeed: [15, 15],
                heatSet: [20, 20],
            },
        });
        const tooltip = option.tooltip as {
            formatter: (params: unknown) => string;
            axisPointer?: { snap?: boolean };
        };
        expect(tooltip.axisPointer?.snap).toBe(false);
        expect(tooltip.formatter([{ axisValue: 71, seriesName: 'BT Target', value: [71, 210.1] }])).toBe('');
        expect(
            tooltip.formatter([
                { axisValue: 120, seriesName: 'BT Target', value: [120, 210.1] },
                { axisValue: 120, seriesName: 'Heat', value: [120, 20] },
            ]),
        ).toBe('');
        expect(
            tooltip.formatter([
                { axisValue: 71, seriesName: 'BT Actual', value: [71, 210] },
                { axisValue: 71, seriesName: 'BT Target', value: [71, 210.1] },
            ]),
        ).toContain('Bean Temp');
    });

    it('still shows history tooltip when currentTimeSec is 0', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [0, 300, 600],
            btActual: [100, 150, 200],
            etActual: [110, 160, 210],
            rorActual: [10, 12, 8],
            currentTimeSec: 0,
            targetXs: [0, 300, 600, 780],
            targetBt: [100, 150, 200, 210],
        });
        const formatter = (option.tooltip as { formatter: (params: unknown) => string }).formatter;
        expect(formatter([{ axisValue: 300, seriesName: 'BT Actual', value: [300, 150] }])).toContain('Bean Temp');
        expect(formatter([{ axisValue: 700, seriesName: 'BT Target', value: [700, 205] }])).toBe('');
    });

    it('draws a dashed Heat set series only when heatSet has values', () => {
        const controlData = { xs: [0, 60], drumTemp: [50, 55], heatPower: [40, 45], fanSpeed: [30, 35] };
        const heatSetSeries = (p: ChartOptionParams) =>
            (buildRoastChartOption(p).series as { name?: string; lineStyle?: { type?: string } }[]).filter(
                (s) => s.name === 'Heat set',
            );

        expect(heatSetSeries({ ...baseParams(), controlData })).toHaveLength(0);
        expect(heatSetSeries({ ...baseParams(), controlData: { ...controlData, heatSet: [null, null] } })).toHaveLength(
            0,
        );
        const [series] = heatSetSeries({ ...baseParams(), controlData: { ...controlData, heatSet: [70, null] } });
        expect(series?.lineStyle?.type).toBe('dashed');
    });

    it('draws the profile Heat target over the control timeline', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            controlData: {
                xs: [0, 60],
                drumTemp: [50, 55],
                heatPower: [40, 45],
                fanSpeed: [30, 35],
                heatTarget: { xs: [0, 120, 600], values: [80, 60, 60] },
            },
        });
        const target = (option.series as { name?: string; data?: number[][]; lineStyle?: { type?: string } }[]).find(
            (series) => series.name === 'Heat target',
        );
        expect(target?.data).toEqual([
            [0, 80],
            [120, 60],
            [600, 60],
        ]);
        expect(target?.lineStyle?.type).toBe('dotted');
    });

    it('adds dual grid and control series when controlData present', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            controlData: {
                xs: [0, 60],
                drumTemp: [50, 55],
                heatPower: [40, 45],
                fanSpeed: [30, 35],
            },
        });
        const series = option.series as { name?: string }[];
        const yAxis = option.yAxis as unknown[];

        expect(option.grid).toHaveLength(2);
        expect(yAxis).toHaveLength(4);
        expect(series.some((s) => s.name === 'Drum')).toBe(true);
        expect(series.some((s) => s.name === 'Heat')).toBe(true);
        expect(series.some((s) => s.name === 'Fan')).toBe(true);
    });

    it('includes NOW markLine when charged with current time in view', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [0, 60, 120],
            btActual: [100, 120, 140],
            etActual: [90, 100, 110],
            rorActual: [10, 12, 8],
            charged: true,
            currentTimeSec: 60,
            eventMarkers: [{ timeSec: 0, event: 'Charge', color: '#0', timeStr: '0:00', temp: '100.0°C' }],
        });
        const series = option.series as { name?: string; markLine?: { data?: unknown[] } }[];
        const bt = series.find((s) => s.name === 'BT Actual');
        expect(bt?.markLine?.data?.length).toBeGreaterThan(0);
    });

    it('shades FC Start–End band on BT series', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [0, 500, 600],
            btActual: [100, 196, 200],
            charged: true,
            currentTimeSec: 600,
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 540, event: 'FC End', color: '#1c', timeStr: '9:00', temp: '200°C' },
            ],
        });
        const series = option.series as { name?: string; markArea?: { data?: unknown[] } }[];
        const bt = series.find((s) => s.name === 'BT Actual');
        expect(bt?.markArea?.data).toEqual([[{ xAxis: 480 }, { xAxis: 540 }]]);
    });

    it('hides FC band when showFcBand is false', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            showFcBand: false,
            xs: [0, 500, 600],
            btActual: [100, 196, 200],
            charged: true,
            currentTimeSec: 600,
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 540, event: 'FC End', color: '#1c', timeStr: '9:00', temp: '200°C' },
            ],
        });
        const series = option.series as { name?: string; markArea?: unknown }[];
        const bt = series.find((s) => s.name === 'BT Actual');
        expect(bt?.markArea).toBeUndefined();
    });

    it('uses the decided live, reference, RoR, and control widths', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [0],
            btActual: [100],
            etActual: [110],
            rorActual: [10],
            rorEtActual: [9],
            showRoRET: true,
            targetXs: [0],
            targetBt: [100],
            controlData: { xs: [0], drumTemp: [50], heatPower: [40], fanSpeed: [30], heatSet: [45] },
        });
        const byName = Object.fromEntries(
            (option.series as { name?: string; lineStyle?: { width?: number; type?: string } }[]).map((series) => [
                series.name,
                series.lineStyle,
            ]),
        );
        expect(byName['BT Actual']?.width).toBe(TEMP_CURVE_WIDTH);
        expect(byName['ET Actual']?.width).toBe(TEMP_CURVE_WIDTH);
        expect(byName.RoR?.width).toBe(TEMP_CURVE_WIDTH);
        expect(byName['ET RoR']?.width).toBe(TEMP_CURVE_WIDTH);
        expect(byName['BT Target']).toMatchObject({ width: TEMP_CURVE_WIDTH, type: 'dashed' });
        expect(byName.Drum?.width).toBe(CONTROL_CURVE_WIDTH);
        expect(byName.Heat?.width).toBe(CONTROL_CURVE_WIDTH);
        expect(byName.Fan?.width).toBe(CONTROL_CURVE_WIDTH);
        expect(byName['Heat set']?.width).toBe(CONTROL_CURVE_WIDTH);
    });

    it.each([
        ['Heat', { showControlDrum: false, showControlHeat: true, showControlFan: false }],
        ['Fan', { showControlDrum: false, showControlHeat: false, showControlFan: true }],
    ] as const)('attaches lower event guides once to a %s-only control plot', (ownerName, visibility) => {
        const option = buildRoastChartOption({
            ...baseParams(),
            ...visibility,
            charged: true,
            currentTimeSec: 60,
            eventMarkerStyle: 'line',
            eventMarkers: [{ timeSec: 30, event: 'Yellow', color: '#old', timeStr: '', temp: '100°C' }],
            controlData: { xs: [0, 60], drumTemp: [50, 55], heatPower: [40, 45], fanSpeed: [30, 35] },
        });
        const series = option.series as { name?: string; markLine?: { data: { xAxis?: number }[] } }[];
        expect(series.find((item) => item.name === ownerName)?.markLine?.data).toEqual(
            expect.arrayContaining([expect.objectContaining({ xAxis: 30 })]),
        );
        expect(series.filter((item) => item.markLine).map((item) => item.name)).toEqual(['BT Actual', ownerName]);
    });

    it('draws both-mode marker lines through the inter-grid gap and clips x manually', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [0, 30, 60],
            btActual: [100, 110, 120],
            eventMarkerStyle: 'both',
            eventMarkers: [{ timeSec: 30, event: 'Note', color: '#old', timeStr: '', temp: '', note: 'Test' }],
            controlData: { xs: [0, 60], drumTemp: [50, 55], heatPower: [40, 45], fanSpeed: [30, 35] },
        });
        const markerSeries = (
            option.series as {
                name?: string;
                renderItem?: (params: unknown, api: unknown) => { shape: { y2: number } } | undefined;
                clip?: boolean;
            }[]
        ).find((series) => series.name === 'Event marker lines');
        expect(markerSeries?.clip).toBe(false);
        const api = {
            coord: () => [50, 100],
            value: (index: number) => [30, Number.NaN, EVENT_MARK_LINE_WIDTH][index],
            getHeight: () => 500,
        };
        expect(
            markerSeries?.renderItem?.({ dataIndex: 0, coordSys: { x: 20, y: 10, width: 200, height: 300 } }, api),
        ).toEqual(
            expect.objectContaining({
                shape: { x1: 50, y1: 10, x2: 50, y2: 470 },
                style: { stroke: baseParams().colors.eventMark, lineWidth: EVENT_MARK_LINE_WIDTH },
            }),
        );
        expect(
            markerSeries?.renderItem?.(
                { dataIndex: 0, coordSys: { x: 60, y: 10, width: 200, height: 300 } },
                { ...api, coord: () => [50, 100] },
            ),
        ).toBeUndefined();
    });

    it('stops both-mode lines at the temperature grid when controls are hidden', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            eventMarkerStyle: 'both',
            eventMarkers: [{ timeSec: 30, event: 'Yellow', color: '#old', timeStr: '', temp: '100°C' }],
        });
        const markerSeries = (
            option.series as {
                name?: string;
                renderItem?: (params: unknown, api: unknown) => { shape: { y2: number } } | undefined;
            }[]
        ).find((series) => series.name === 'Event marker lines');
        const result = markerSeries?.renderItem?.(
            { dataIndex: 0, coordSys: { x: 20, y: 10, width: 200, height: 300 } },
            {
                coord: () => [50, 100],
                value: (index: number) => [30, Number.NaN, EVENT_MARK_LINE_WIDTH][index],
                getHeight: () => 500,
            },
        );
        expect(result?.shape.y2).toBe(310);
    });

    it('draws event labels on the BT axis, not the grid edge', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [0, 60],
            btActual: [100, 185],
            eventMarkerStyle: 'both',
            eventMarkers: [{ timeSec: 60, event: 'FC Start', color: '#old', timeStr: '', temp: '185°C' }],
        });
        const labelSeries = (
            option.series as {
                name?: string;
                yAxisIndex?: number;
                data?: unknown[];
                renderItem?: (
                    params: unknown,
                    api: unknown,
                ) => { type: string; children: { type: string; x: number; y: number; style?: { font?: string } }[] };
            }[]
        ).find((series) => series.name === 'Event curve labels');
        expect(labelSeries?.yAxisIndex).toBe(0);
        expect(labelSeries?.data).toEqual([[0]]);
        const result = labelSeries?.renderItem?.(
            { dataIndex: 0, coordSys: { x: 0, y: 0, width: 400, height: 300 } },
            { coord: (value: number[]) => [value[0] * 2, 250 - value[1]], getWidth: () => 440 },
        );
        const text = result?.children.find((child) => child.type === 'text');
        expect(text).toMatchObject({ type: 'text', x: 124, y: 65, style: { font: MARKER_LABEL_FONT } });
        expect(result?.children.some((child) => child.type === 'circle')).toBe(false);
    });

    it('draws nothing when the anchor is outside the grid on x or y', () => {
        const option = buildRoastChartOption({
            ...baseParams(),
            xs: [0, 60],
            btActual: [100, 185],
            eventMarkers: [{ timeSec: 60, event: 'FC Start', color: '#old', timeStr: '', temp: '185°C' }],
        });
        const renderItem = (
            option.series as {
                name?: string;
                renderItem?: (params: unknown, api: unknown) => { children?: unknown[] } | undefined;
            }[]
        ).find((series) => series.name === 'Event curve labels')?.renderItem;
        const grid = { dataIndex: 0, coordSys: { x: 40, y: 10, width: 400, height: 300 } };
        expect(renderItem?.(grid, { coord: () => [-20, 80], getWidth: () => 800 })).toBeUndefined();
        expect(renderItem?.(grid, { coord: () => [120, 400], getWidth: () => 800 })).toBeUndefined();
    });

    it('clears a label left outside the window on the next merged frame and restores it when zoom resets', () => {
        const full = buildRoastChartOption({
            ...baseParams(),
            xs: [0, 122, 660],
            btActual: [100, 141.7, 197],
            etActual: [110, 150, 200],
            rorActual: [5, 4, 2],
            showET: true,
            showRoR: true,
            showTargetCurve: true,
            targetXs: [0, 660],
            targetBt: [100, 197],
            charged: true,
            currentTimeSec: 660,
            eventMarkerStyle: 'line',
            turningPoints: [{ timeSec: 122, temp: 141.7 }],
        });
        const zoomed = buildRoastChartOption({
            ...baseParams(),
            xs: [600, 660],
            btActual: [196, 197],
            etActual: [200, 201],
            rorActual: [2, 2],
            showET: true,
            showRoR: true,
            showTargetCurve: true,
            targetXs: [600, 660],
            targetBt: [197, 197],
            charged: true,
            currentTimeSec: 660,
            eventMarkerStyle: 'line',
            turningPoints: [{ timeSec: 122, temp: 141.7 }],
            xViewMin: 600,
            xViewMax: 660,
        });
        const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 800, height: 420 });
        chart.setOption(full);
        expect(chart.renderToSVGString()).toContain('TP|02:02');
        chart.setOption(zoomed);
        expect(chart.renderToSVGString()).not.toContain('TP|02:02');
        chart.setOption(full);
        expect(chart.renderToSVGString()).toContain('TP|02:02');
        chart.dispose();
    });

    const fullReference = {
        xs: [0, 60],
        btActual: [100, 140],
        etActual: [110, 150],
        rorActual: [8, 6],
        rorEtActual: [4, 3],
        showRoRET: true,
        targetXs: [0, 30, 60],
        targetBt: [100, 120, 140],
        targetEt: [110, null, 150],
        targetRor: [8, 6, null],
        controlData: {
            xs: [0, 60],
            drumTemp: [40, 45],
            heatPower: [50, 55],
            fanSpeed: [20, 25],
            heatSet: [50, 55],
            heatTarget: { xs: [0, 60], values: [70, 70] },
            reference: {
                xs: [0, 30, 60],
                drum: [40, null, 42],
                heater: [60, 60, null],
                fan: [0, null, 12],
            },
        },
    };

    type NamedSeries = {
        name?: string;
        connectNulls?: boolean;
        xAxisIndex?: number;
        yAxisIndex?: number;
        z?: number;
        data?: unknown;
        lineStyle?: { color?: string; width?: number; type?: string };
    };
    const seriesByName = (params: ChartOptionParams) => {
        const byName: Record<string, NamedSeries> = {};
        for (const series of buildRoastChartOption(params).series as NamedSeries[]) {
            if (series.name) byName[series.name] = series;
        }
        return byName;
    };

    it('draws stored reference channels in the channel color without filling gaps', () => {
        const byName = seriesByName({ ...baseParams(), ...fullReference });
        expect(byName['ET Target']).toMatchObject({
            connectNulls: false,
            yAxisIndex: 0,
            z: 1,
            data: [
                [0, 110],
                [30, null],
                [60, 150],
            ],
            lineStyle: { color: mockColors.etTarget, width: TEMP_CURVE_WIDTH, type: 'dashed' },
        });
        expect(byName['RoR Target']).toMatchObject({
            yAxisIndex: 1,
            connectNulls: false,
            data: [
                [0, 8],
                [30, 6],
                [60, null],
            ],
            lineStyle: { color: mockColors.rorTarget, width: TEMP_CURVE_WIDTH, type: 'dashed' },
        });
        expect(byName['BT Target']).toMatchObject({
            lineStyle: { color: mockColors.btTarget, width: TEMP_CURVE_WIDTH, type: 'dashed' },
        });
        expect(byName['Drum Target']).toMatchObject({
            xAxisIndex: 1,
            yAxisIndex: 2,
            data: [
                [0, 40],
                [30, null],
                [60, 42],
            ],
            lineStyle: { color: mockColors.controlDrumTarget, type: 'dashed' },
        });
        expect(byName['Heater Target']).toMatchObject({
            yAxisIndex: 3,
            data: [
                [0, 60],
                [30, 60],
                [60, null],
            ],
            lineStyle: { color: mockColors.controlHeatTarget, width: CONTROL_CURVE_WIDTH, type: 'dashed' },
        });
        expect(byName['Fan Target']).toMatchObject({
            data: [
                [0, 0],
                [30, null],
                [60, 12],
            ],
            lineStyle: { color: mockColors.controlFanTarget },
        });
        expect(byName['Heat target']).toMatchObject({
            data: [
                [0, 70],
                [60, 70],
            ],
            lineStyle: { type: 'dotted', color: mockColors.controlHeat },
        });
        expect(byName['Heat set']?.lineStyle).toMatchObject({ type: 'dashed', color: mockColors.controlHeat });
        expect(byName['ET RoR Target']).toBeUndefined();
        const names = Object.keys(byName);
        expect(names.indexOf('Heater Target')).toBeLessThan(names.indexOf('Heat target'));
        expect(names.indexOf('Heat target')).toBeLessThan(names.indexOf('Heat set'));
        expect(names.indexOf('Heat set')).toBeLessThan(names.indexOf('Heat'));

        const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 800, height: 480 });
        chart.setOption(
            buildRoastChartOption({
                ...baseParams(),
                ...fullReference,
                colors: { ...mockColors, etTarget: '#123456' },
            }),
        );
        const svg = chart.renderToSVGString();
        chart.dispose();
        expect(svg).toContain('#123456');
        expect(svg).toContain('stroke-dasharray');
    });

    it('omits reference channels that were not stored', () => {
        const names = Object.keys(
            seriesByName({
                ...baseParams(),
                targetXs: [0, 60],
                targetBt: [100, 140],
                targetEt: [null, null],
                targetRor: [null, null],
                controlData: {
                    xs: [0, 60],
                    drumTemp: [40, 45],
                    heatPower: [50, 55],
                    fanSpeed: [20, 25],
                    heatTarget: { xs: [0, 60], values: [70, 70] },
                    reference: {
                        xs: [0, 60],
                        drum: [null, null],
                        heater: [null, null],
                        fan: [null, null],
                    },
                },
            }),
        );
        expect(names).toContain('BT Target');
        expect(names).toContain('Heat target');
        for (const name of ['ET Target', 'RoR Target', 'Drum Target', 'Heater Target', 'Fan Target', 'ET RoR Target']) {
            expect(names).not.toContain(name);
        }
    });

    it('hides reference curves from the profile channel toggles, not the live series toggles', () => {
        const hidden = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showTargetCurve: false }));
        for (const name of ['BT Target', 'ET Target', 'RoR Target', 'Drum Target', 'Heater Target', 'Fan Target']) {
            expect(hidden).not.toContain(name);
        }
        expect(hidden).toContain('Heat target');
        expect(hidden).toContain('Heat set');
        expect(hidden).toContain('ET RoR');

        const etOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showET: false }));
        expect(etOff).toContain('ET Target');
        expect(etOff).not.toContain('ET Actual');

        const profileEtOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showProfileEt: false }));
        expect(profileEtOff).not.toContain('ET Target');
        expect(profileEtOff).toContain('ET Actual');
        expect(profileEtOff).toContain('BT Target');

        const rorOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showRoR: false }));
        expect(rorOff).toContain('RoR Target');
        expect(rorOff).not.toContain('RoR');
        expect(rorOff).not.toContain('ET RoR');

        const profileRorOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showProfileRor: false }));
        expect(profileRorOff).not.toContain('RoR Target');
        expect(profileRorOff).toContain('RoR');

        const heatOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showControlHeat: false }));
        expect(heatOff).toContain('Heater Target');
        expect(heatOff).not.toContain('Heat');
        expect(heatOff).not.toContain('Heat set');
        expect(heatOff).not.toContain('Heat target');

        const profileHeatOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showProfileHeat: false }));
        expect(profileHeatOff).not.toContain('Heater Target');
        expect(profileHeatOff).toContain('Heat');
        expect(profileHeatOff).toContain('Fan Target');

        const fanOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showProfileFan: false }));
        expect(fanOff).not.toContain('Fan Target');
        expect(fanOff).toContain('Fan');

        const drumOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showProfileDrum: false }));
        expect(drumOff).not.toContain('Drum Target');
        expect(drumOff).toContain('Drum');

        const profileBtOff = Object.keys(seriesByName({ ...baseParams(), ...fullReference, showProfileBt: false }));
        expect(profileBtOff).not.toContain('BT Target');
        expect(profileBtOff).toContain('BT Actual');
    });
});
