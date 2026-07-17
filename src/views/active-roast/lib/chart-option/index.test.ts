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
    eventYellow: '#1a',
    eventFcStart: '#1b',
    eventFcEnd: '#1c',
    eventEnd: '#1d',
    eventNote: '#1e',
    eventDrop: '#1f',
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
});
