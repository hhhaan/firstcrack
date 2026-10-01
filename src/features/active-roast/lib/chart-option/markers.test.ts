import {
    EVENT_MARK_LINE_WIDTH,
    MARKER_LABEL_GAP_PX,
    MARKER_LABEL_STACK_PX,
    MARKER_LABEL_X_OFFSET_PX,
} from '@features/active-roast/lib/chart-config';
import { describe, expect, it } from 'vitest';
import {
    buildMarkers,
    clampCurveLabelY,
    estimateLabelWidth,
    getMarkerLabelGeometry,
    LABEL_BELOW_EVENTS,
    layoutCurveLabelBoxes,
    NOTE_LABEL_TOP_INSET_PX,
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
                text: 'FC Start|08:00|196.0°C',
                below: false,
                showDot: eventMarkerStyle === 'point',
            }),
            expect.objectContaining({
                timeSec: 520,
                y: 200,
                text: 'FC Rolling|08:40|200.0°C',
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
            text: 'Open damper|09:00|200.0°C',
            color: '#eee',
            y: baseParams.tempYMax,
            below: true,
            topInsetPx: NOTE_LABEL_TOP_INSET_PX,
            showDot: false,
        });
        expect(result.curveLabels[1]).toMatchObject({
            text: 'Heater→50%|09:00|200.0°C',
            color: '#c00',
            y: 202,
            showDot: false,
        });
        expect(result.allMarkLines).not.toEqual(expect.arrayContaining([expect.objectContaining({ xAxis: 540 })]));
        expect(result.continuousMarkerLines).toEqual([
            { timeSec: 540, color: '#888', width: EVENT_MARK_LINE_WIDTH },
            { timeSec: 540, color: '#c00', width: EVENT_MARK_LINE_WIDTH },
        ]);
    });

    it('keeps an empty-curve Note at the top of the temperature axis', () => {
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
            below: true,
            text: 'No sample|09:51',
            showDot: false,
        });
    });

    it('returns Note formatter text literally', () => {
        const result = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [{ timeSec: 540, event: 'Note', color: '#old', timeStr: '', temp: '', note: '{b}' }],
        });
        expect(result.curveLabels[0]?.text).toBe('{b}|09:00|202.0°C');
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
        expect(eventLine.lineStyle).toMatchObject({ color: '#888', width: EVENT_MARK_LINE_WIDTH });
        expect(eventLine.label).toEqual({ show: false });
        expect(result.curveLabels[0]?.text).toBe('Yellow|08:00|196.0°C');
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
        text: 'FC Start | 08:10 | 185.8°C',
        below: false,
        color: '#111',
        showDot: false,
        ...overrides,
    });

    it('keeps a note whose anchor sits a fraction above the axis line', () => {
        expect(clampCurveLabelY(39.4, 40, 200)).toBe(40);
        expect(clampCurveLabelY(40, 40, 200)).toBe(40);
        expect(clampCurveLabelY(38, 40, 200)).toBeNull();
        expect(clampCurveLabelY(241, 40, 200)).toBeNull();
    });

    it('drops a top-pinned note below the axis by NOTE_LABEL_TOP_INSET_PX', () => {
        const [box] = layoutCurveLabelBoxes([
            item({ below: true, yPx: 40, topInsetPx: NOTE_LABEL_TOP_INSET_PX, text: '하이|07:47|—' }),
        ]);
        expect(box.textY).toBe(40 + NOTE_LABEL_TOP_INSET_PX);
        expect(box.top).toBe(box.textY);
    });

    it('keeps isolated labels on their preferred side of BT', () => {
        const [box] = layoutCurveLabelBoxes([item({})]);
        expect(box.textY).toBe(200);
        expect(box.top).toBe(200 - MARKER_LABEL_STACK_PX);
        expect(box.bottom).toBe(200);
    });

    it('sits 4px to the right of the anchor, left-aligned', () => {
        const text = 'TP|02:40|152.2°C';
        const [box] = layoutCurveLabelBoxes([item({ xPx: 100, text })]);
        expect(box.x).toBe(100 + MARKER_LABEL_X_OFFSET_PX);
        expect(box.left).toBe(box.x);
        expect(box.right).toBe(box.x + estimateLabelWidth(text));
    });

    it('does not pull an off-canvas anchor back into the plot', () => {
        const [box] = layoutCurveLabelBoxes([item({ xPx: -400, timeSec: 10 })], 1000);
        expect(box.x).toBe(-400 + MARKER_LABEL_X_OFFSET_PX);
        expect(box.anchorX).toBe(-400);
    });

    it('keeps edge labels inside the canvas while preserving their curve anchors', () => {
        const boxes = layoutCurveLabelBoxes(
            [item({ xPx: 0, timeSec: 0 }), item({ xPx: 980, timeSec: 600, text: 'Drop | 10:00 | 205.0°C' })],
            1000,
        );
        expect(boxes[0].left).toBe(4);
        expect(boxes[0].anchorX).toBe(0);
        expect(boxes[1].right).toBe(996);
        expect(boxes[1].anchorX).toBe(980);
    });

    it('stacks same-spot labels so their boxes do not overlap', () => {
        const [first, second] = layoutCurveLabelBoxes([
            item({ timeSec: 490, text: 'FC Start | 08:10 | 185.8°C' }),
            item({ timeSec: 490, text: 'Heater→35%|08:10|185.8°C' }),
        ]);
        expect(second.bottom).toBeLessThanOrEqual(first.top - MARKER_LABEL_GAP_PX);
        expect(second.textY).toBe(first.textY - (MARKER_LABEL_STACK_PX + MARKER_LABEL_GAP_PX));
    });

    it('nudges a later Drop above the FC cluster instead of overlapping', () => {
        const boxes = layoutCurveLabelBoxes([
            item({ timeSec: 490, xPx: 800, yPx: 120, text: 'FC Start | 08:10 | 185.8°C' }),
            item({ timeSec: 490, xPx: 800, yPx: 120, text: 'Heater→35%|08:10|185.8°C' }),
            item({ timeSec: 520, xPx: 820, yPx: 110, text: 'FC Rolling | 08:40 | 191.5°C', below: true }),
            item({ timeSec: 630, xPx: 900, yPx: 90, text: 'Drop | 10:30 | 207.0°C' }),
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

describe('zoom window (#599)', () => {
    const tp = { timeSec: 122, temp: 141.7 };
    const yellow = { timeSec: 60, event: 'Yellow', color: '#old', timeStr: '1:00', temp: '120°C' };
    const fc = { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' };

    it.each(['point', 'both', 'line'] as const)(
        '%s: hides labels, lines, and dots outside the visible window',
        (eventMarkerStyle) => {
            const result = buildMarkers({
                ...baseParams,
                eventMarkerStyle,
                xMin: 600,
                xMax: 660,
                xs: [600, 660],
                btActual: [190, 197],
                hasControlSeries: true,
                currentTimeSec: 660,
                eventMarkers: [yellow, fc],
                turningPoints: [tp],
            });
            expect(result.curveLabels).toEqual([]);
            expect(result.continuousMarkerLines).toEqual([]);
            const xAxes = [...result.allMarkLines, ...result.controlGuideMarkLines].map(
                (line) => (line as { xAxis?: number }).xAxis,
            );
            expect(xAxes).not.toContain(60);
            expect(xAxes).not.toContain(122);
            expect(xAxes).not.toContain(480);
        },
    );

    it('shows an in-window label on the BT sample at that time', () => {
        const result = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            xMin: 100,
            xMax: 160,
            xs: [120, 122, 140],
            btActual: [140, 141.7, 150],
            eventMarkers: [],
            turningPoints: [tp],
        });
        expect(result.curveLabels).toEqual([
            expect.objectContaining({
                timeSec: 122,
                y: 141.7,
                text: 'TP|02:02|141.7°C',
                showDot: true,
            }),
        ]);
        expect(result.continuousMarkerLines).toEqual([]);
    });

    it('restores labels when the window resets to the full range', () => {
        const markers = [yellow, fc];
        const zoomed = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'line',
            xMin: 600,
            xMax: 660,
            xs: [600, 660],
            btActual: [190, 197],
            eventMarkers: markers,
            turningPoints: [tp],
        });
        expect(zoomed.curveLabels).toEqual([]);

        const reset = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'line',
            xMin: 0,
            xMax: 700,
            xs: [0, 60, 122, 480, 660],
            btActual: [100, 120, 141.7, 196, 197],
            eventMarkers: markers,
            turningPoints: [tp],
        });
        expect(reset.curveLabels.map((label) => label.timeSec)).toEqual([60, 480, 122]);
        expect(reset.curveLabels.map((label) => label.y)).toEqual([120, 196, 141.7]);
        expect(reset.allMarkLines.map((line) => (line as { xAxis?: number }).xAxis)).toEqual(
            expect.arrayContaining([60, 480, 122]),
        );
    });

    it('hides a marker when the filtered series has no finite BT near its time', () => {
        const result = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'both',
            xMin: 100,
            xMax: 660,
            xs: [400, 460, 600],
            btActual: [190, null, 197],
            eventMarkers: [{ timeSec: 130, event: 'Yellow', color: '#old', timeStr: '2:10', temp: '150°C' }],
            turningPoints: [tp],
        });
        expect(nearestBtAt([400, 460, 600], [190, null, 197], 122)).toBeNull();
        expect(nearestBtAt([400, 460, 600], [190, null, 197], 130)).toBeNull();
        expect(result.curveLabels).toEqual([]);
        expect(result.continuousMarkerLines).toEqual([]);
    });

    it('keeps a Note on the axis when the curve has not reached that time', () => {
        const result = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'both',
            xMin: 0,
            xMax: 780,
            currentTimeSec: 14,
            xs: [0, 14, 780],
            btActual: [200, 187.2, null],
            eventMarkers: [{ timeSec: 300, event: 'Note', color: '#old', timeStr: '5:00', temp: '', note: 'ㅎ' }],
        });
        expect(result.curveLabels).toEqual([
            expect.objectContaining({
                timeSec: 300,
                y: baseParams.tempYMax,
                text: 'ㅎ|05:00',
                below: true,
                topInsetPx: NOTE_LABEL_TOP_INSET_PX,
            }),
        ]);
        expect(result.continuousMarkerLines).toEqual([expect.objectContaining({ timeSec: 300 })]);
    });
});

describe('getMarkerLabelGeometry', () => {
    it('sits right of the BT anchor and stacks one box per rank', () => {
        expect(
            getMarkerLabelGeometry({
                anchorX: 900,
                anchorY: 200,
                rank: 2,
                text: 'label',
            }),
        ).toEqual({
            x: 900 + MARKER_LABEL_X_OFFSET_PX,
            y: 200 - MARKER_LABEL_STACK_PX * 2,
            align: 'left',
            text: 'label',
            rank: 2,
        });
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
                    text: 'Charge|00:00|210.1°C',
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

    it('hides Charge curve label when hideChargeLabel, keeps other events', () => {
        const { curveLabels, allMarkLines } = buildMarkers({
            ...baseParams,
            xs: [0, 480],
            btActual: [210.1, 196],
            hideChargeLabel: true,
            eventMarkerStyle: 'line',
            eventMarkers: [
                chargeMarker,
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
            ],
        });
        expect(curveLabels.some((l) => l.text.includes('Charge'))).toBe(false);
        expect(curveLabels).toEqual([expect.objectContaining({ text: 'FC Start|08:00|196.0°C', timeSec: 480 })]);
        expect(allMarkLines.some((l) => (l as { xAxis?: number }).xAxis === 0)).toBe(false);
    });
});
