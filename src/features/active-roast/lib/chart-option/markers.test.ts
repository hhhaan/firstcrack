import { describe, expect, it } from 'vitest';
import {
    buildMarkers,
    getMarkerLabelGeometry,
    LABEL_BELOW_EVENTS,
    layoutCurveLabelBoxes,
    nearestBtAt,
} from './markers';
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

describe('LABEL_BELOW_EVENTS', () => {
    it('puts FC Rolling / FC End / TP below; FC Start / Yellow / Drop above', () => {
        expect(LABEL_BELOW_EVENTS.has('FC Rolling')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('FC End')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('TP')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('Drop')).toBe(false);
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
    it.each(['point', 'both', 'line'] as const)('%s: FC Start above BT, FC Rolling below BT', (eventMarkerStyle) => {
        const { curveLabels, markPointData } = buildMarkers({
            ...baseParams,
            eventMarkerStyle,
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 520, event: 'FC Rolling', color: '#5a9', timeStr: '8:40', temp: '200°C' },
            ],
        });
        expect(markPointData).toEqual([]);
        expect(curveLabels).toEqual([
            expect.objectContaining({
                timeSec: 480,
                y: 196,
                text: '[08:00] FC Start @ 196.0°C',
                below: false,
                showDot: eventMarkerStyle === 'point',
            }),
            expect.objectContaining({
                timeSec: 520,
                y: 200,
                text: '[08:40] FC Rolling @ 200.0°C',
                below: true,
                showDot: eventMarkerStyle === 'point',
            }),
        ]);
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

        expect(result.markPointData).toEqual([]);
        expect(result.curveLabels[0]).toMatchObject({
            text: '[09:00] Open damper @ 200.0°C',
            color: '#eee',
            y: 202,
            showDot: false,
        });
        expect(result.curveLabels[1]).toMatchObject({
            text: '[09:00] Heater → 50% @ 200.0°C',
            color: '#c00',
            y: 202,
            showDot: false,
        });
        expect(result.allMarkLines).not.toEqual(expect.arrayContaining([expect.objectContaining({ xAxis: 540 })]));
        expect(result.continuousMarkerLines).toEqual([
            { timeSec: 540, color: '#888', width: 0.6 },
            { timeSec: 540, color: '#c00', width: 1 },
        ]);
    });

    it('keeps an empty-curve Note visible at the plot top, still centered on BT', () => {
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
        expect(result.curveLabels[0]).toMatchObject({
            timeSec: 591,
            y: 250,
            text: '[09:51] No sample @ —',
            showDot: false,
        });
    });

    it('returns Note formatter text literally', () => {
        const result = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [{ timeSec: 540, event: 'Note', color: '#old', timeStr: '', temp: '', note: '{b}' }],
        });
        expect(result.curveLabels[0]?.text).toBe('[09:00] {b} @ 202.0°C');
        expect(result.curveLabels[0]?.showDot).toBe(true);
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
            label: { show: boolean };
        };
        expect(eventLine.lineStyle).toMatchObject({ color: '#888', width: 0.6 });
        expect(eventLine.label).toEqual({ show: false });
        expect(result.curveLabels[0]?.text).toBe('[08:00] Yellow @ 196.0°C');
        expect(result.controlGuideMarkLines).toEqual(
            expect.arrayContaining([expect.objectContaining({ xAxis: 480, label: { show: false } })]),
        );
    });
});

describe('layoutCurveLabelBoxes', () => {
    const item = (overrides: Partial<Parameters<typeof layoutCurveLabelBoxes>[0][number]>) => ({
        timeSec: 0,
        xPx: 100,
        yPx: 200,
        text: '[08:10] FC Start @ 185.8°C',
        below: false,
        color: '#111',
        showDot: false,
        ...overrides,
    });

    it('keeps isolated labels on their preferred side of BT', () => {
        const [box] = layoutCurveLabelBoxes([item({})]);
        expect(box.textY).toBe(188);
        expect(box.top).toBe(174);
        expect(box.bottom).toBe(188);
    });

    it('stacks same-spot labels so their boxes do not overlap', () => {
        const [first, second] = layoutCurveLabelBoxes([
            item({ timeSec: 490, text: '[08:10] FC Start @ 185.8°C' }),
            item({ timeSec: 490, text: '[08:10] Heater → 35% @ 185.8°C' }),
        ]);
        expect(second.bottom).toBeLessThanOrEqual(first.top - 2);
        expect(second.textY).toBeLessThan(first.textY);
    });

    it('nudges a later Drop above the FC cluster instead of overlapping', () => {
        const boxes = layoutCurveLabelBoxes([
            item({ timeSec: 490, xPx: 800, yPx: 120, text: '[08:10] FC Start @ 185.8°C' }),
            item({ timeSec: 490, xPx: 800, yPx: 120, text: '[08:10] Heater → 35% @ 185.8°C' }),
            item({ timeSec: 520, xPx: 820, yPx: 110, text: '[08:40] FC Rolling @ 191.5°C', below: true }),
            item({ timeSec: 630, xPx: 900, yPx: 90, text: '[10:30] Drop @ 207.0°C' }),
        ]);
        const drop = boxes[3];
        const others = boxes.slice(0, 3);
        for (const other of others) {
            const overlap =
                drop.left < other.right &&
                drop.right > other.left &&
                drop.top < other.bottom &&
                drop.bottom > other.top;
            expect(overlap).toBe(false);
        }
        expect(drop.textY).toBeLessThan(90);
    });
});

describe('getMarkerLabelGeometry', () => {
    it('centers on the BT anchor and stacks 14px above the curve', () => {
        expect(
            getMarkerLabelGeometry({
                anchorX: 900,
                anchorY: 200,
                rank: 2,
                text: 'label',
            }),
        ).toEqual({ x: 900, y: 160, align: 'center', text: 'label', rank: 2 });
    });
});

describe('Charge marker (#451)', () => {
    const chargeMarker = {
        timeSec: 0,
        event: 'Charge',
        color: '#fa0',
        timeStr: '0:00',
        temp: '210.1°C',
    };

    it('line style: no Charge vertical line, curve label only', () => {
        const { allMarkLines, controlGuideMarkLines, curveLabels, continuousMarkerLines } = buildMarkers({
            ...baseParams,
            xs: [0, 60],
            btActual: [210.1, 200],
            currentTimeSec: 60,
            hasControlSeries: true,
            eventMarkerStyle: 'line',
            eventMarkers: [chargeMarker],
        });
        expect(allMarkLines.some((l) => (l as { xAxis?: number }).xAxis === 0)).toBe(false);
        expect(controlGuideMarkLines.some((l) => (l as { xAxis?: number }).xAxis === 0)).toBe(false);
        expect(continuousMarkerLines.some((l) => l.timeSec === 0)).toBe(false);
        expect(curveLabels).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    timeSec: 0,
                    text: '[00:00] Charge @ 210.1°C',
                    showDot: false,
                }),
            ]),
        );
    });

    it('point style: Charge is label-only, other events stay as dots', () => {
        const { curveLabels, allMarkLines } = buildMarkers({
            ...baseParams,
            xs: [0, 480],
            btActual: [210.1, 196],
            eventMarkerStyle: 'point',
            eventMarkers: [
                chargeMarker,
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
            ],
        });
        const byEvent = Object.fromEntries(
            curveLabels.map((l) => [l.text.includes('Charge') ? 'Charge' : 'FC Start', l]),
        );
        expect(byEvent.Charge.showDot).toBe(false);
        expect(byEvent['FC Start'].showDot).toBe(true);
        expect(allMarkLines.some((l) => (l as { xAxis?: number }).xAxis === 0)).toBe(false);
    });
});
