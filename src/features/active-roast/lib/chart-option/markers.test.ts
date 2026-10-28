import {
    EVENT_MARK_LINE_WIDTH,
    MARKER_LABEL_GAP_PX,
    MARKER_LABEL_STACK_PX,
    MARKER_LABEL_X_OFFSET_PX,
    REFERENCE_CURVE_OPACITY,
} from '@features/active-roast/lib/chart-config';

import { describe, expect, it } from 'vitest';
import {
    buildMarkers,
    clampCurveLabelY,
    estimateLabelWidth,
    eventLabelText,
    getMarkerLabelGeometry,
    layoutCurveLabelBoxes,
    NOTE_LABEL_TOP_INSET_PX,
    nearestBtAt,
} from './markers';
import { buildCurveLabelSeries } from './series';
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

it.each(['0%', '60%', '2.5 kPa'])('draws original reference heat events for %s with reduced opacity', (note) => {
    const result = buildMarkers({
        ...baseParams,
        eventMarkerStyle: 'line',
        eventMarkers: [
            {
                reference: true,
                timeSec: 630,
                event: 'Heater',
                color: '',
                timeStr: '10:30',
                temp: '204°C',
                tempC: 204,
                note,
            },
        ],
    });
    expect(result.allMarkLines).toContainEqual(
        expect.objectContaining({
            xAxis: 630,
            lineStyle: expect.objectContaining({
                color: colors.eventControl,
                opacity: REFERENCE_CURVE_OPACITY,
                type: 'solid',
            }),
        }),
    );
    expect(result.curveLabels).toContainEqual(
        expect.objectContaining({
            timeSec: 630,
            y: 204,
            color: colors.eventControl,
            opacity: REFERENCE_CURVE_OPACITY,
            text: `${note}|10:30|204.0°C`,
        }),
    );
});

it.each([false, true])('renders event text and points with source opacity (reference: %s)', (reference) => {
    const { curveLabels } = buildMarkers({
        ...baseParams,
        eventMarkerStyle: 'point',
        eventMarkers: [
            { reference, timeSec: 540, event: 'Heater', color: '', timeStr: '', temp: '', tempC: 204, note: '60%' },
        ],
    });
    const rendered = buildCurveLabelSeries(curveLabels).renderItem(
        { dataIndex: 0, coordSys: { x: 0, y: 0, width: 400, height: 300 } },
        { coord: () => [120, 100], getWidth: () => 440 },
    );
    const style = { fill: colors.eventControl, opacity: reference ? REFERENCE_CURVE_OPACITY : 1 };
    expect(rendered?.children).toEqual([
        expect.objectContaining({ type: 'circle', style: expect.objectContaining(style) }),
        expect.objectContaining({
            type: 'text',
            style: expect.objectContaining({ ...style, text: '60%|09:00|204.0°C' }),
        }),
    ]);
});

it('paints an opaque background behind printed event text so curves cannot cross the letters', () => {
    const { curveLabels } = buildMarkers({
        ...baseParams,
        eventMarkerStyle: 'point',
        eventMarkers: [{ timeSec: 540, event: 'Drop', color: '', timeStr: '', temp: '202°C' }],
    });
    const rendered = buildCurveLabelSeries(curveLabels, 1, '#ffffff').renderItem(
        { dataIndex: 0, coordSys: { x: 0, y: 0, width: 700, height: 300 } },
        { coord: () => [120, 100], getWidth: () => 800 },
    );
    const label = rendered?.children.find((child) => child.type === 'text');
    expect(label?.style.backgroundColor).toBe('#ffffff');
    expect(label?.style.width).toBeLessThan(200);
});

it('stacks major event text at the plot top while keeping points on BT', () => {
    const { curveLabels } = buildMarkers({
        ...baseParams,
        eventMarkerStyle: 'point',
        xs: [60, 480],
        btActual: [100, 200],
        eventMarkers: [
            { timeSec: 480, event: 'FC Start', color: '', timeStr: '', temp: '200°C' },
            { timeSec: 60, event: 'Yellow', color: '', timeStr: '', temp: '100°C' },
        ],
    });
    const rendered = buildCurveLabelSeries(curveLabels).renderItem(
        { dataIndex: 0, coordSys: { x: 0, y: 10, width: 700, height: 300 } },
        { coord: ([time, bt]: number[]) => [time, bt], getWidth: () => 800, getHeight: () => 400 },
    );
    expect(rendered?.children).toEqual([
        expect.objectContaining({ type: 'circle', shape: expect.objectContaining({ cx: 480, cy: 200 }) }),
        expect.objectContaining({
            type: 'text',
            y: 10 + NOTE_LABEL_TOP_INSET_PX + MARKER_LABEL_STACK_PX + MARKER_LABEL_GAP_PX,
            style: expect.objectContaining({ text: 'FC Start|08:00|200.0°C' }),
        }),
        expect.objectContaining({ type: 'circle', shape: expect.objectContaining({ cx: 60, cy: 100 }) }),
        expect.objectContaining({
            type: 'text',
            y: 10 + NOTE_LABEL_TOP_INSET_PX,
            style: expect.objectContaining({ text: 'Yellow|01:00|100.0°C' }),
        }),
    ]);
});

it('keeps the final event label inside the plot and away from the right axis', () => {
    const { curveLabels } = buildMarkers({
        ...baseParams,
        eventMarkerStyle: 'point',
        eventMarkers: [{ timeSec: 540, event: 'Drop', color: '', timeStr: '', temp: '202°C' }],
    });
    const rendered = buildCurveLabelSeries(curveLabels).renderItem(
        { dataIndex: 0, coordSys: { x: 32, y: 10, width: 700, height: 300 } },
        { coord: () => [732, 100], getWidth: () => 800, getHeight: () => 400 },
    );
    const label = rendered?.children.find((child) => child.type === 'text');
    const dot = rendered?.children.find((child) => child.type === 'circle');
    expect(label).toBeDefined();
    expect(label?.x + estimateLabelWidth(label?.style.text)).toBeLessThan(732);
    expect(dot?.shape.cx).toBe(732);
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
    it.each(['point', 'tempLine', 'line'] as const)(
        '%s: FC Start and FC Rolling text start at the top independently of BT',
        (eventMarkerStyle) => {
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
                    below: true,
                    labelAtTop: true,
                    showDot: eventMarkerStyle === 'point',
                }),
                expect.objectContaining({
                    timeSec: 520,
                    y: 200,
                    text: 'FC Rolling|08:40|200.0°C',
                    below: true,
                    labelAtTop: true,
                    showDot: eventMarkerStyle === 'point',
                }),
            ]);
        },
    );
});

describe('event marker visual grammar', () => {
    it('ignores nonfinite curve samples when anchoring labels', () => {
        expect(nearestBtAt([Number.NaN, 20], [180, Number.POSITIVE_INFINITY], 10)).toBeNull();
    });

    it('draws tempLine on the temperature chart and leaves the control chart clear', () => {
        const result = buildMarkers({
            ...baseParams,
            hasControlSeries: true,
            eventMarkerStyle: 'tempLine',
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
            y: 202,
            below: true,
            topInsetPx: NOTE_LABEL_TOP_INSET_PX,
            showDot: false,
        });
        expect(result.curveLabels[1]).toMatchObject({
            text: '50%|09:00|200.0°C',
            color: '#c00',
            y: 202,
            showDot: false,
        });
        const eventLines = result.allMarkLines.filter((line) => (line as { xAxis?: number }).xAxis === 540) as {
            lineStyle: { color: string; width: number };
        }[];
        expect(eventLines.map((line) => line.lineStyle)).toEqual([
            { color: '#888', width: EVENT_MARK_LINE_WIDTH, type: 'solid', opacity: 1 },
            { color: '#c00', width: EVENT_MARK_LINE_WIDTH, type: 'solid', opacity: 1 },
        ]);
        expect(result.controlGuideMarkLines.some((line) => (line as { xAxis?: number }).xAxis === 540)).toBe(false);
    });

    it('keeps an empty-curve Note at the top of the temperature axis', () => {
        const result = buildMarkers({
            ...baseParams,
            xMin: 500,
            xMax: 600,
            xs: [],
            btActual: [],
            tempYMax: 250,
            eventMarkerStyle: 'tempLine',
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
        expect(result.curveLabels[0]?.y).toBe(202);
        expect(result.curveLabels[0]?.showDot).toBe(true);
    });

    it('retains line mode and mirrors its event guides into the control grid', () => {
        const result = buildMarkers({
            ...baseParams,
            hasControlSeries: true,
            eventMarkerStyle: 'line',
            eventMarkers: [{ timeSec: 480, event: 'Yellow', color: '#old', timeStr: '', temp: '196°C' }],
        });
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
    it.each([1, 1.5, 2])('stacks reference heat, events, notes, fan, and drum together at scale %s', (scale) => {
        const { curveLabels } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'line',
            fontScale: scale,
            xs: [2, 3, 4, 5, 6, 8],
            btActual: [180, 175, 170, 165, 160, 155],
            eventMarkers: [
                { timeSec: 2, event: 'Heater', note: '70%', tempC: 180, reference: true },
                { timeSec: 3, event: 'Yellow' },
                { timeSec: 4, event: 'Note', note: 'Check\naroma' },
                { timeSec: 5, event: 'Fan', note: '50' },
                { timeSec: 6, event: 'Drum', note: '55' },
                { timeSec: 8, event: 'FC Start' },
            ]
                .reverse()
                .map((marker) => ({ ...marker, color: '', timeStr: '', temp: '' })),
        });
        const rendered = buildCurveLabelSeries(curveLabels, scale).renderItem(
            { dataIndex: 0, coordSys: { x: 0, y: 10, width: 700, height: 300 } },
            { coord: ([time, bt]: number[]) => [time * 50, bt], getWidth: () => 800, getHeight: () => 400 },
        );
        const labels = rendered?.children.filter((child) => child.type === 'text').sort((a, b) => a.y - b.y);
        expect(labels?.map((label) => label.style.text)).toEqual([
            '70%|00:02|180.0°C',
            'Yellow|00:03|175.0°C',
            '00:04 | 170.0°C\nCheck\naroma',
            'Fan 50|00:05',
            'Drum 55|00:06',
            'FC Start|00:08|155.0°C',
        ]);
        let top = 10 + NOTE_LABEL_TOP_INSET_PX * scale;
        for (const label of labels ?? []) {
            expect(label.y).toBe(top);
            top += (MARKER_LABEL_STACK_PX * label.style.text.split('\n').length + MARKER_LABEL_GAP_PX) * scale;
        }
    });

    it.each([1, 1.5, 2])('keeps nearby one-line event labels in chronological order at scale %s', (scale) => {
        const boxes = layoutCurveLabelBoxes(
            [
                { timeSec: 8, xPx: 44, yPx: 192, text: eventLabelText('FC Start', 8, '190.7°C') },
                { timeSec: 7, xPx: 40, yPx: 191, text: eventLabelText('Yellow', 7, '191.6°C') },
            ].map((item) => ({ ...item, below: false, color: '#111', showDot: true })),
            400,
            scale,
            300,
        );
        const [later, earlier] = boxes;
        expect(earlier.text).toBe('Yellow|00:07|191.6°C');
        expect(later.text).toBe('FC Start|00:08|190.7°C');
        expect(earlier.bottom + MARKER_LABEL_GAP_PX * scale).toBeLessThanOrEqual(later.top);
        expect(boxes.map((box) => box.anchorX)).toEqual([44, 40]);
        expect(boxes.map((box) => box.anchorY)).toEqual([192, 191]);
    });

    it.each([0, 10, 290, 300])('keeps chronological labels on the canvas near y=%s', (yPx) => {
        const boxes = layoutCurveLabelBoxes(
            [
                { timeSec: 7, text: 'Yellow|00:07|191.6°C', below: false },
                { timeSec: 8, text: 'FC Start|00:08|190.7°C', below: false },
                { timeSec: 9, text: 'FC Rolling|00:09|192.0°C', below: true },
            ].map((item) => ({ ...item, xPx: 40, yPx, color: '#111', showDot: false })),
            400,
            1,
            300,
        );
        for (let index = 0; index < boxes.length; index++) {
            expect(boxes[index].top).toBeGreaterThanOrEqual(0);
            expect(boxes[index].bottom).toBeLessThanOrEqual(300);
            if (index) expect(boxes[index - 1].bottom + MARKER_LABEL_GAP_PX).toBeLessThanOrEqual(boxes[index].top);
        }
    });

    it('packs neighboring oversized notes without overlapping their compact previews', () => {
        const boxes = layoutCurveLabelBoxes(
            [0, 1].map((timeSec) => ({
                timeSec,
                xPx: 100,
                yPx: 150,
                text: '한'.repeat(120),
                below: true,
                color: '#111',
                showDot: false,
            })),
            220,
            2,
            300,
        );
        for (let i = 0; i < boxes.length; i++) {
            expect(boxes[i].top).toBeGreaterThanOrEqual(0);
            expect(boxes[i].bottom).toBeLessThanOrEqual(300);
            for (let j = i + 1; j < boxes.length; j++) {
                expect(boxes[i].bottom <= boxes[j].top || boxes[j].bottom <= boxes[i].top).toBe(true);
            }
        }
    });

    it.each([0, 13, 27, 28])('keeps the hit box inside a canvas only %spx high', (height) => {
        const [box] = layoutCurveLabelBoxes(
            [{ timeSec: 1, xPx: 100, yPx: 150, text: '한'.repeat(120), below: true, color: '#111', showDot: false }],
            220,
            2,
            height,
        );
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(height);
        expect(box.text).toBe(height < MARKER_LABEL_STACK_PX * 2 ? '' : '…');
    });

    it.each([false, true])('bounds an oversized CJK note at 2x scale (below=%s) and retains its content', (below) => {
        const text = eventLabelText(
            'Note',
            61,
            '123.4°C',
            `Gas 0\nAirflow 1.234 kPa\nDrum 55.5 RPM\n${'한'.repeat(120)}`,
        );
        const [box] = layoutCurveLabelBoxes(
            [{ timeSec: 61, xPx: 218, yPx: 190, text, below, color: '#111', showDot: false }],
            220,
            2,
            300,
        );
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(300);
        expect(box.text.endsWith('…')).toBe(true);
        expect(box.fullText).toBe(text);
        expect(box.bottom - box.top).toBe(MARKER_LABEL_STACK_PX * 2 * box.text.split('\n').length);
    });

    it.each([1, 1.5, 2])('wraps every compound note value within both canvas edges at scale %s', (scale) => {
        const payload = 'Gas 0\nAirflow 1.234 kPa\nDrum 55.5 RPM\n한글메모 long-value-12345678901234567890';
        const text = eventLabelText('Note', 61, '123.4°C', payload);
        const boxes = layoutCurveLabelBoxes(
            [
                {
                    timeSec: 61,
                    xPx: 218,
                    yPx: 190,
                    text,
                    below: true,
                    color: '#111',
                    showDot: false,
                },
            ],
            220,
            scale,
            500,
        );
        const box = boxes[0];
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(220);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(500);
        expect(box.text.replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
        expect(box.bottom - box.top).toBe(MARKER_LABEL_STACK_PX * scale * box.text.split('\n').length);
    });
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
            item({ timeSec: 490, text: '35%|08:10|185.8°C' }),
        ]);
        expect(first.bottom + MARKER_LABEL_GAP_PX).toBeLessThanOrEqual(second.top);
        expect(second.textY).toBe(first.textY + (MARKER_LABEL_STACK_PX + MARKER_LABEL_GAP_PX));
    });

    it('keeps a later Drop below the earlier FC cluster instead of overlapping', () => {
        const boxes = layoutCurveLabelBoxes([
            item({ timeSec: 490, xPx: 800, yPx: 120, text: 'FC Start | 08:10 | 185.8°C' }),
            item({ timeSec: 490, xPx: 800, yPx: 120, text: '35%|08:10|185.8°C' }),
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
        for (const other of others) expect(other.bottom + MARKER_LABEL_GAP_PX).toBeLessThanOrEqual(drop.top);
    });
});

describe('zoom window (#599)', () => {
    const tp = { timeSec: 122, temp: 141.7 };
    const yellow = { timeSec: 60, event: 'Yellow', color: '#old', timeStr: '1:00', temp: '120°C' };
    const fc = { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' };

    it.each(['point', 'tempLine', 'line'] as const)(
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
            eventMarkerStyle: 'tempLine',
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
        expect(result.allMarkLines.some((line) => (line as { xAxis?: number }).xAxis === 130)).toBe(false);
    });

    it('keeps a Note on the axis when the curve has not reached that time', () => {
        const result = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'tempLine',
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
                showDot: false,
            }),
        ]);
        const pointed = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            xMin: 0,
            xMax: 780,
            currentTimeSec: 14,
            xs: [0, 14, 780],
            btActual: [200, 187.2, null],
            eventMarkers: [{ timeSec: 300, event: 'Note', color: '#old', timeStr: '5:00', temp: '', note: 'ㅎ' }],
        });
        expect(pointed.curveLabels[0]).toMatchObject({ y: baseParams.tempYMax, showDot: false });
        expect(result.allMarkLines).toEqual(expect.arrayContaining([expect.objectContaining({ xAxis: 300 })]));
        expect(result.controlGuideMarkLines.some((line) => (line as { xAxis?: number }).xAxis === 300)).toBe(false);
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
        const { allMarkLines, controlGuideMarkLines, curveLabels } = buildMarkers({
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

describe('fan and drum change labels', () => {
    const marker = (event: 'Fan' | 'Drum', timeSec: number, note: string) => ({
        logId: `${event}-${timeSec}`,
        timeSec,
        event,
        color: '#old',
        timeStr: '',
        temp: '',
        note,
    });

    it('stamps fan and drum at the top axis in the gas-note color, with no temperature', () => {
        const { curveLabels, allMarkLines, controlGuideMarkLines } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'line',
            hasControlSeries: true,
            eventMarkers: [marker('Fan', 469, '50'), marker('Drum', 469, '55')],
        });
        expect(curveLabels).toEqual([
            expect.objectContaining({
                timeSec: 469,
                y: baseParams.tempYMax,
                below: true,
                text: 'Fan 50|07:49',
                topInsetPx: NOTE_LABEL_TOP_INSET_PX,
                showDot: false,
                color: '#eee',
            }),
            expect.objectContaining({ timeSec: 469, text: 'Drum 55|07:49', color: '#eee' }),
        ]);
        const lineAt = (lines: object[], timeSec: number) =>
            lines.filter((line) => (line as { xAxis?: number }).xAxis === timeSec);
        expect(lineAt(allMarkLines, 469)).toHaveLength(2);
        expect(lineAt(allMarkLines, 469)[0]).toMatchObject({
            lineStyle: { color: '#888', width: EVENT_MARK_LINE_WIDTH, type: 'solid' },
            label: { show: false },
        });
        expect(lineAt(controlGuideMarkLines, 469)).toHaveLength(2);
    });
});
