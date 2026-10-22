import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockChartColors as mockColors } from './chart-colors.fixture';
import { buildCompareChartOption, type CompareChartSeries } from './compare';
import { buildRoastChartOption } from './index';
import type { ChartOptionParams } from './types';

type LineSeriesOption = {
    id?: string;
    name?: string;
    smooth?: boolean | number;
    sampling?: string;
};

const expectRawPolyline = (series: LineSeriesOption | undefined, label: string) => {
    expect(series, `${label}: series missing`).toBeDefined();
    expect(series?.smooth, `${label}: smooth must be falsy`).toBeFalsy();
    expect(series?.sampling, `${label}: sampling must be undefined`).toBeUndefined();
};

const findSeriesByName = (option: { series?: unknown }, name: string) =>
    (option.series as LineSeriesOption[] | undefined)?.find((s) => s.name === name);

const findCompareSeries = (option: { series?: unknown }, kind: 'bt' | 'ror', sessionId: string) =>
    (option.series as LineSeriesOption[] | undefined)?.find((s) => s.name === `${kind}|${sessionId}`);

const activeRoastMeasuredParams = (): ChartOptionParams => ({
    xs: [0, 30, 60, 120],
    btActual: [100, 120, 140, 155],
    etActual: [110, 125, 145, 160],
    rorActual: [null, 12, 10, 8],
    rorEtActual: [null, 11, 9, 7],
    btTarget: [],
    currentTimeSec: 120,
    charged: true,
    eventMarkerStyle: 'point',
    eventMarkers: [],
    turningPoints: [],
    temperatureUnit: 'C',
    showET: true,
    showTargetCurve: false,
    showRoR: true,
    showRoRET: true,
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
    controlData: {
        xs: [0, 30, 60, 120],
        drumTemp: [48, 50, 52, 54],
        heatPower: [80, 70, 60, 55],
        fanSpeed: [30, 35, 40, 45],
    },
});

const ACTIVE_MEASURED_SERIES = ['BT Actual', 'ET Actual', 'RoR', 'ET RoR', 'Drum'] as const;

describe('roast chart raw polyline (no ECharts smooth / LTTB)', () => {
    it('active roast measured series use straight polylines only', () => {
        const option = buildRoastChartOption(activeRoastMeasuredParams());
        for (const name of ACTIVE_MEASURED_SERIES) {
            expectRawPolyline(findSeriesByName(option, name), name);
        }
    });
});

describe('history compare chart raw polyline', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const twoSessionSeries: CompareChartSeries[] = [
        {
            id: 'session-a',
            label: 'Batch A',
            batchIndex: 0,
            points: [
                { t: 0, bt: 200, et: 210, ror: 10 },
                { t: 60, bt: 180, et: 195, ror: 8 },
            ],
        },
        {
            id: 'session-b',
            label: 'Batch B',
            batchIndex: 1,
            points: [
                { t: 0, bt: 195, et: 205, ror: 9 },
                { t: 90, bt: 170, et: 188, ror: 7 },
            ],
        },
    ];

    it('BT and RoR overlay series per session use straight polylines only', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));

        const option = buildCompareChartOption(twoSessionSeries, { xView: { start: 0, end: 120 } });
        for (const id of ['session-a', 'session-b']) {
            expectRawPolyline(findCompareSeries(option, 'bt', id), `bt|${id}`);
            expectRawPolyline(findCompareSeries(option, 'ror', id), `ror|${id}`);
        }
    });
});
