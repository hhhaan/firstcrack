import { describe, expect, it } from 'vitest';
import { buildRoastChartOption } from './index';
import type { ChartOptionParams, ResolvedChartColors } from './types';

const mockColors: ResolvedChartColors = {
    btTarget: '#1',
    btTargetTooltip: '#2',
    btActual: '#3',
    etActual: '#4',
    rorActual: '#5',
    tp: '#6',
    phaseLines: '#7',
    currentTimeLine: '#8',
    nowLabel: '#9',
    gridLine: '#a',
    gridLineMinor: '#b',
    axisLabel: '#c',
    axisPointerLine: '#d',
    tooltipTimeColor: '#e',
    tooltipBg: '#f',
    tooltipBorder: '#10',
    markerLabelColor: '#11',
    phaseBarStroke: '#12',
    phaseBarName: '#13',
    phaseBarDuration: '#14',
    controlDrum: '#15',
    controlHeat: '#16',
    controlHeatArea: '#17',
    controlFan: '#18',
    controlFanArea: '#19',
    eventMark: '#23',
    eventControl: '#24',
    fcBandFill: 'rgba(105,103,225,0.1)',
    bbpFill: '#efeff0',
    targetDeltaWithin: '#20',
    targetDeltaOver: '#21',
    targetDeltaUnder: '#22',
};

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

describe('buildRoastChartOption', () => {
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

        // BT Actual always present; ET + RoR with defaults → 3 series
        expect(series).toHaveLength(3);
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
        expect(byName['BT Actual']?.width).toBe(1.2);
        expect(byName['ET Actual']?.width).toBe(0.9);
        expect(byName.RoR?.width).toBe(0.9);
        expect(byName['ET RoR']?.width).toBe(0.9);
        expect(byName['BT Target']).toMatchObject({ width: 0.8, type: 'dashed' });
        expect(byName.Drum?.width).toBe(1);
        expect(byName.Heat?.width).toBe(1);
        expect(byName.Fan?.width).toBe(1);
        expect(byName['Heat set']?.width).toBe(1);
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
            xs: [0, 60],
            btActual: [100, 120],
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
        const api = { coord: () => [50, 100], value: (index: number) => [30, '#23', 0.6][index], getHeight: () => 500 };
        expect(markerSeries?.renderItem?.({ coordSys: { x: 20, y: 10, width: 200, height: 300 } }, api)).toEqual(
            expect.objectContaining({ shape: { x1: 50, y1: 10, x2: 50, y2: 470 } }),
        );
        expect(
            markerSeries?.renderItem?.(
                { coordSys: { x: 60, y: 10, width: 200, height: 300 } },
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
            { coordSys: { x: 20, y: 10, width: 200, height: 300 } },
            { coord: () => [50, 100], value: (index: number) => [30, '#23', 0.6][index], getHeight: () => 500 },
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
                ) => { type: string; children: { type: string; x: number; y: number }[] };
            }[]
        ).find((series) => series.name === 'Event curve labels');
        expect(labelSeries?.yAxisIndex).toBe(0);
        expect(labelSeries?.data).toEqual([[0]]);
        const result = labelSeries?.renderItem?.(
            { dataIndex: 0, coordSys: { x: 0, y: 0, width: 400, height: 300 } },
            { coord: (value: number[]) => [value[0] * 2, 250 - value[1]] },
        );
        const text = result?.children.find((child) => child.type === 'text');
        expect(text).toMatchObject({ type: 'text', x: 124, y: 65 });
        expect(result?.children.some((child) => child.type === 'circle')).toBe(false);
    });
});
