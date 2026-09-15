import { describe, expect, it } from 'vitest';
import { buildMarkers, getMarkerLabelGeometry, LABEL_BELOW_EVENTS, nearestBtAt } from './markers';
import type { ResolvedChartColors } from './types';

const colors = {
    phaseLines: '#aaa',
    currentTimeLine: '#bbb',
    nowLabel: '#ccc',
    tp: '#ddd',
    markerLabelColor: '#eee',
    eventMark: '#888',
    eventControl: '#c00',
    fcBandFill: 'rgba(0,0,0,0.05)',
    axisLabel: '#111',
    targetDeltaWithin: '#0f0',
    targetDeltaOver: '#f00',
    targetDeltaUnder: '#00f',
} as unknown as ResolvedChartColors;

const baseParams = {
    charged: true,
    currentTimeSec: 600,
    xMin: 0,
    xMax: 700,
    turningPoints: [] as [],
    temperatureUnit: 'C' as const,
    unitLabel: '°C',
    xs: [480, 500, 520, 540],
    btActual: [196, 198, 200, 202] as (number | null)[],
    colors,
    tempYMin: 50,
    tempYMax: 250,
    hasControlSeries: false,
    showFcBand: false,
};

const formatterText = (formatter: string | (() => string)) =>
    typeof formatter === 'function' ? formatter() : formatter;

describe('LABEL_BELOW_EVENTS', () => {
    it('puts FC Rolling / FC End / Drop below; FC Start / Yellow above', () => {
        expect(LABEL_BELOW_EVENTS.has('FC Rolling')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('FC End')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('Drop')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('FC Start')).toBe(false);
        expect(LABEL_BELOW_EVENTS.has('Yellow')).toBe(false);
    });
});

describe('FC band vs dual-mark Rolling', () => {
    it('ends the band at FC End, not FC Rolling', () => {
        const { fcMarkArea } = buildMarkers({
            ...baseParams,
            showFcBand: true,
            eventMarkerStyle: 'line',
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 520, event: 'FC Rolling', color: '#5a9', timeStr: '8:40', temp: '200°C' },
                { timeSec: 560, event: 'FC End', color: '#c00', timeStr: '9:20', temp: '205°C' },
            ],
        });
        expect(fcMarkArea).toEqual(expect.objectContaining({ data: [[{ xAxis: 480 }, { xAxis: 560 }]] }));
    });

    it('live-extends to now when FC End is missing, ignoring Rolling', () => {
        const { fcMarkArea } = buildMarkers({
            ...baseParams,
            showFcBand: true,
            charged: true,
            currentTimeSec: 600,
            eventMarkerStyle: 'line',
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 520, event: 'FC Rolling', color: '#5a9', timeStr: '8:40', temp: '200°C' },
            ],
        });
        expect(fcMarkArea).toEqual(expect.objectContaining({ data: [[{ xAxis: 480 }, { xAxis: 600 }]] }));
    });
});

describe('buildMarkers label position', () => {
    it('point style: FC Start top, FC Rolling bottom', () => {
        const { markPointData } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 520, event: 'FC Rolling', color: '#5a9', timeStr: '8:40', temp: '200°C' },
            ],
        });
        const byName = Object.fromEntries(
            (markPointData as { name: string; label: { position: string } }[]).map((p) => [p.name, p.label.position]),
        );
        expect(byName['FC Start']).toBe('top');
        expect(byName['FC Rolling']).toBe('bottom');
    });

    it('line style: FC Start start(top), FC Rolling end(bottom)', () => {
        const { allMarkLines } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'line',
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 520, event: 'FC Rolling', color: '#5a9', timeStr: '8:40', temp: '200°C' },
            ],
        });
        const eventLines = allMarkLines as {
            xAxis?: number;
            label?: { position: string; formatter?: string | (() => string) };
        }[];
        const start = eventLines.find(
            (line) => line.label?.formatter && formatterText(line.label.formatter).includes('FC Start'),
        );
        const rolling = eventLines.find(
            (line) => line.label?.formatter && formatterText(line.label.formatter).includes('FC Rolling'),
        );
        expect(start?.label?.position).toBe('start');
        expect(rolling?.label?.position).toBe('end');
    });
});

describe('event marker visual grammar', () => {
    it('ignores nonfinite curve samples when anchoring labels', () => {
        expect(nearestBtAt([Number.NaN, 20], [180, Number.POSITIVE_INFINITY], 10)).toBeNull();
    });

    it('renders both as one curve label plus a full-height line with category widths and colors', () => {
        const result = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'both',
            eventMarkers: [
                {
                    logId: 'note-1',
                    timeSec: 540,
                    event: 'Note',
                    color: '#old',
                    timeStr: '9:00',
                    temp: '',
                    tempC: 200,
                    note: 'Open damper',
                },
                {
                    logId: 'heat-1',
                    timeSec: 540,
                    event: 'Heater',
                    color: '#old',
                    timeStr: '9:00',
                    temp: '',
                    tempC: 200,
                    note: '50%',
                },
            ],
        });

        const points = result.markPointData as {
            name: string;
            symbolSize: number;
            label: { formatter: () => string; color: string; position: string; offset: [number, number] };
        }[];
        expect(points[0]).toMatchObject({
            name: 'note-1',
            symbolSize: 0,
            label: { color: '#eee', position: 'right', offset: [0, 0] },
        });
        expect(points[0]?.label.formatter()).toBe('[09:00] Open damper @ 200.0°C');
        expect(points[1]).toMatchObject({ name: 'heat-1', label: { color: '#c00', offset: [0, -14] } });
        expect(points[1]?.label.formatter()).toBe('[09:00] Heater → 50% @ 200.0°C');
        expect(result.allMarkLines).not.toEqual(expect.arrayContaining([expect.objectContaining({ xAxis: 540 })]));
        expect(result.continuousMarkerLines).toEqual([
            { timeSec: 540, color: '#888', width: 0.6 },
            { timeSec: 540, color: '#c00', width: 1 },
        ]);
    });

    it('puts >90% curve labels inward and keeps an empty-curve Note visible at the plot top', () => {
        const result = buildMarkers({
            ...baseParams,
            xMin: 500,
            xMax: 600,
            xs: [],
            btActual: [],
            tempYMax: 250,
            eventMarkerStyle: 'both',
            eventMarkers: [{ timeSec: 591, event: 'Note', color: '#old', timeStr: '', temp: '', note: 'No sample' }],
        });
        const [point] = result.markPointData as {
            coord: [number, number];
            label: { formatter: () => string; position: string; align: string };
        }[];
        expect(point.coord).toEqual([591, 250]);
        expect(point.label).toMatchObject({
            position: 'left',
            align: 'right',
        });
        expect(point.label.formatter()).toBe('[09:51] No sample @ —');
    });

    it('returns Note formatter text literally', () => {
        const result = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [{ timeSec: 540, event: 'Note', color: '#old', timeStr: '', temp: '', note: '{b}' }],
        });
        const [point] = result.markPointData as { label: { formatter: () => string } }[];
        expect(point.label.formatter()).toBe('[09:00] {b} @ 202.0°C');
    });

    it('retains line mode and mirrors its event guides into the control grid', () => {
        const result = buildMarkers({
            ...baseParams,
            hasControlSeries: true,
            eventMarkerStyle: 'line',
            eventMarkers: [{ timeSec: 480, event: 'Yellow', color: '#old', timeStr: '', temp: '196°C' }],
        });
        expect(result.continuousMarkerLines).toEqual([]);
        const eventLine = result.allMarkLines.find((line) => (line as { xAxis?: number }).xAxis === 480) as {
            lineStyle: { color: string; width: number };
            label: { formatter: () => string };
        };
        expect(eventLine.lineStyle).toMatchObject({ color: '#888', width: 0.6 });
        expect(eventLine.label.formatter()).toBe('[08:00] Yellow @ 196.0°C');
        expect(result.controlGuideMarkLines).toEqual(
            expect.arrayContaining([expect.objectContaining({ xAxis: 480, label: { show: false } })]),
        );
    });
});

describe('getMarkerLabelGeometry', () => {
    it('matches the rendered 14px stack and visible-range inward placement', () => {
        expect(
            getMarkerLabelGeometry({
                anchorX: 900,
                anchorY: 200,
                timeSec: 95,
                xMin: 0,
                xMax: 100,
                rank: 2,
                text: 'label',
            }),
        ).toEqual({ x: 894, y: 172, align: 'right', text: 'label', rank: 2 });
    });
});
