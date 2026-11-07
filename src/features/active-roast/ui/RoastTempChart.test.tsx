// @vitest-environment jsdom

import type { ControlData } from '@features/active-roast/lib/chart-option';
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import * as echarts from 'echarts';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastTempChart, type RoastTempChartHandle } from './RoastTempChart';

const replaceMarkerTime = (input: HTMLInputElement, data: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, data);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { chart, paper, convertFromPixel, convertToPixel, setOption, zrHandlers } = vi.hoisted(() => {
    const setOption = vi.fn();
    const zrHandlers = new Map<string, (event: Record<string, number>) => void>();
    const convertFromPixel = vi.fn((_finder: object, value: number | number[]) =>
        Array.isArray(value) ? Number.NaN : value / 10,
    );
    const convertToPixel = vi.fn((_finder: object, value: number | number[]) =>
        Array.isArray(value) ? Number.NaN : value * 10,
    );
    const chart = {
        containPixel: vi.fn(() => true),
        convertFromPixel,
        convertToPixel,
        dispose: vi.fn(),
        getZr: vi.fn(() => ({
            off: vi.fn((name: string) => zrHandlers.delete(name)),
            on: vi.fn((name: string, handler: (event: Record<string, number>) => void) =>
                zrHandlers.set(name, handler),
            ),
        })),
        init: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        resize: vi.fn(),
        setOption,
        getWidth: () => 1000,
        getHeight: () => 300,
        getOption: vi.fn(() => ({})),
        getDataURL: vi.fn(() => 'data:image/png;base64,qq'),
    };
    const paper = {
        ...chart,
        setOption: vi.fn(),
        dispose: vi.fn(),
        getDataURL: vi.fn(() => 'data:image/png;base64,qq'),
    };
    return { chart, paper, convertFromPixel, convertToPixel, setOption, zrHandlers };
});

vi.mock('echarts', () => ({
    init: vi.fn((element: HTMLElement) => (element.style.left === '-9999px' ? paper : chart)),
}));

const baseProps = {
    xs: [0, 60],
    btTarget: [],
    btActual: [180, 185],
    etActual: [200, 205],
    rorActual: [5, 5],
    currentTimeSec: 60,
    eventMarkers: [],
    height: 300,
    controlChartHeightPct: 21,
    controlYMin: 0,
    controlYMax: 100,
    phaseSegments: [],
};

const controlData = (heatSet: ControlData['heatSet']): ControlData => ({
    xs: [0, 60],
    drumTemp: [50, 55],
    heatPower: [40, 45],
    fanSpeed: [30, 35],
    heatSet,
});

beforeEach(() => {
    Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { load: vi.fn().mockResolvedValue([]) },
    });
    chart.dispose.mockClear();
    paper.setOption.mockClear();
    paper.dispose.mockClear();
    paper.getDataURL.mockClear();
});

describe('RoastTempChart Heat set lifecycle', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.stubGlobal(
            'ResizeObserver',
            class {
                disconnect() {}
                observe() {}
            },
        );
        setOption.mockClear();
        convertFromPixel.mockClear();
        convertToPixel.mockClear();
        zrHandlers.clear();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            measureText: (text: string) => ({ width: text.length * 6 }),
        } as CanvasRenderingContext2D);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const renderChart = (heatSet: ControlData['heatSet'], props = {}) => {
        act(() => {
            root.render(createElement(RoastTempChart, { ...baseProps, controlData: controlData(heatSet), ...props }));
        });
    };

    it('replaces the chart structure when merging and separating controls', () => {
        renderChart([50, 60]);
        expect(setOption.mock.lastCall?.[0].grid).toHaveLength(2);
        renderChart([50, 60], { mergeControlChart: true });
        expect(setOption.mock.lastCall?.[0].grid).toHaveLength(1);
        expect(setOption.mock.lastCall?.[1]).toMatchObject({ notMerge: true });
        renderChart([50, 60], { mergeControlChart: false });
        expect(setOption.mock.lastCall?.[0].grid).toHaveLength(2);
        expect(setOption.mock.lastCall?.[1]).toMatchObject({ notMerge: true });
    });

    it('edits number spacing independently of grid spacing and preserves number lists', () => {
        const original = getRoastSettings();
        const ticks = [150, 175, 200];
        try {
            act(() =>
                updateRoastSettings({
                    temperatureUnit: 'C',
                    tempLabelInterval: 50,
                    tempTickMode: 'interval',
                    tempTicksC: ticks,
                    horizontalGridMode: 'custom',
                    horizontalGridInterval: 1,
                    rorLabelInterval: 2,
                    timeTickCustom: true,
                    timeTickIntervalSec: 45,
                }),
            );
            renderChart([null, null]);
            const initial = setOption.mock.lastCall?.[0];
            const range = [initial.yAxis[0].min, initial.yAxis[0].max];
            expect(initial.yAxis[0].axisLabel.customValues).toContain(150);
            expect(initial.yAxis[0].axisLabel.customValues).not.toContain(175);
            expect(initial.yAxis[0].interval).toBe(1);
            expect(initial.yAxis[1].interval).toBe(2);
            expect(initial.xAxis[0].interval).toBe(45);
            act(() => updateRoastSettings({ tempTickMode: 'list' }));
            expect(setOption.mock.lastCall?.[0].yAxis[0].axisLabel.customValues).toEqual(ticks);
            act(() => updateRoastSettings({ tempTickMode: 'interval', tempLabelInterval: 25, rorLabelInterval: 3 }));
            const updated = setOption.mock.lastCall?.[0];
            expect(updated.yAxis[0].axisLabel.customValues).toContain(175);
            expect([updated.yAxis[0].min, updated.yAxis[0].max]).toEqual(range);
            expect(updated.yAxis[0].interval).toBe(1);
            expect(updated.yAxis[1].interval).toBe(3);
            expect(updated.yAxis[1].axisLabel.customValues).toContain(3);
            expect(updated.yAxis[1].axisLabel.customValues).not.toContain(2);
            expect(getRoastSettings().tempTicksC).toEqual(ticks);
            act(() => updateRoastSettings({ timeTickCustom: false, timeTickPresetSec: 90 }));
            expect(setOption.mock.lastCall?.[0].xAxis[0].interval).toBe(90);
            expect(getRoastSettings().timeTickIntervalSec).toBe(45);
        } finally {
            act(() => updateRoastSettings(original));
        }
    });

    it('changes shared grid spacing independently of RoR number lists', () => {
        const original = getRoastSettings();
        try {
            act(() =>
                updateRoastSettings({
                    temperatureUnit: 'C',
                    horizontalGridMode: 'custom',
                    horizontalGridInterval: 1,
                    horizontalGridPresetInterval: 10,
                    rorTickMode: 'list',
                    rorTicksC: [-5, 0, 5],
                }),
            );
            renderChart([null, null], { showRoR: true });
            const check = (interval: number) => {
                const option = setOption.mock.lastCall?.[0];
                expect(option.yAxis[0].splitLine.show).toBe(true);
                expect(option.yAxis[1].splitLine.show).toBe(false);
                expect(option.yAxis[0].interval).toBe(interval);
                expect(option.yAxis[1].axisLabel.customValues).toEqual([-5, 0, 5]);
            };
            check(1);
            act(() => updateRoastSettings({ horizontalGridMode: 'preset' }));
            check(10);
            act(() => updateRoastSettings({ horizontalGridMode: 'custom' }));
            check(1);
        } finally {
            act(() => updateRoastSettings(original));
        }
    });

    it('rebuilds the option when Heat set appears and disappears', () => {
        renderChart([null, null]);
        const initial = setOption.mock.calls[setOption.mock.calls.length - 1];
        expect(initial?.[1]).toMatchObject({ notMerge: false });

        renderChart([70, null]);
        const added = setOption.mock.calls[setOption.mock.calls.length - 1];
        expect(added).toBeDefined();
        expect(added?.[1]).toMatchObject({ notMerge: true });
        const addedOption = added?.[0] as { series: { name?: string }[] };
        const addedNames = addedOption.series.map((series) => series.name);
        expect(addedNames.indexOf('Heat set')).toBeLessThan(addedNames.indexOf('Heat'));

        renderChart([null, null]);
        const removed = setOption.mock.calls[setOption.mock.calls.length - 1];
        expect(removed).toBeDefined();
        expect(removed?.[1]).toMatchObject({ notMerge: true });
        const removedOption = removed?.[0] as { series: { name?: string }[] };
        expect(removedOption.series.some((series) => series.name === 'Heat set')).toBe(false);
    });

    it('rebuilds when visible control series change', () => {
        renderChart([null, null], { showControlDrum: true, showControlHeat: true });
        renderChart([null, null], { showControlDrum: false, showControlHeat: true });
        expect(setOption.mock.calls[setOption.mock.calls.length - 1]?.[1]).toMatchObject({ notMerge: true });

        renderChart([null, null], { showControlDrum: false, showControlHeat: false, showControlFan: false });
        expect(setOption.mock.calls[setOption.mock.calls.length - 1]?.[1]).toMatchObject({ notMerge: true });
    });
});

describe('RoastTempChart interactions', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.stubGlobal(
            'ResizeObserver',
            class {
                disconnect() {}
                observe() {}
            },
        );
        zrHandlers.clear();
        convertToPixel.mockImplementation((_finder, value) => (Array.isArray(value) ? Number.NaN : value * 10));
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            measureText: (text: string) => ({ width: text.length * 6 }),
        } as CanvasRenderingContext2D);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each([101, 113, 125, 175, 199])('matches rendered labels and click/drag bounds at %s%%', (fontScalePct) => {
        const previous = getRoastSettings().fontScalePct;
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDrag = vi.fn();
        try {
            act(() => {
                updateRoastSettings({ fontScalePct });
                root.render(
                    createElement(RoastTempChart, {
                        ...baseProps,
                        ref,
                        xs: [0, 5, 8],
                        btActual: [180, 185, 190],
                        eventMarkerStyle: 'callout',
                        eventMarkers: [
                            {
                                logId: 'reference-heat',
                                reference: true,
                                event: 'Heater',
                                timeSec: 2,
                                timeStr: '0:02',
                                temp: '180°C',
                                tempC: 180,
                                note: '50%',
                                color: '#888',
                            },
                            {
                                logId: 'yellow-1',
                                event: 'Yellow',
                                timeSec: 5,
                                timeStr: '0:05',
                                temp: '185°C',
                                color: '#888',
                            },
                        ],
                        onEventMarkerDrag,
                        onEventMarkerEdit: vi.fn(),
                    }),
                );
            });
            const option = setOption.mock.calls[setOption.mock.calls.length - 1]?.[0];
            vi.spyOn(chart, 'convertToPixel').mockImplementation((finder, value) => {
                if (Array.isArray(value)) return Number.NaN;
                return 'yAxisIndex' in finder
                    ? option.yAxis[0].max - value
                    : value === option.xAxis[0].max
                      ? 1000
                      : value * 10;
            });
            const series = option.series.find((s: { id: string }) => s.id === 'event-curve-labels');
            const rendered = series.renderItem(
                { dataIndex: 0, coordSys: { x: 0, y: 0, width: 1000, height: 200 } },
                {
                    coord: ([x, y]: number[]) => [x * 10, option.yAxis[0].max - y],
                    getWidth: () => 1000,
                    getHeight: chart.getHeight,
                },
            );
            const label = rendered.children.find(
                (child: { type: string; style?: { text?: string } }) =>
                    child.type === 'text' && child.style?.text?.startsWith('Yellow'),
            );
            const reference = rendered.children.find(
                (child: { type: string; style?: { text?: string } }) =>
                    child.type === 'text' && child.style?.text?.startsWith('50%'),
            );
            const scale = fontScalePct / 100;
            expect(label.style.text).toBe('Yellow|00:05|185.0°C');
            expect(label.style.font).toBe(`600 ${12 * scale}px Inconsolata`);
            expect(label.x).toBe(50 + 16 * scale);
            expect(reference.y).toBe(8 * scale);
            const leader = rendered.children.find((child: { type: string }) => child.type === 'line');
            expect(leader.shape).toMatchObject({ x1: 50, y1: 65 });
            expect(label.y).toBeGreaterThanOrEqual(reference.y + 17 * scale + 2 * scale);
            expect(label.y).toBeLessThan(150);
            expect(ref.current?.hitTestMarker({ clientX: label.x + 100 * scale, clientY: reference.y + 1 })).toBe(
                false,
            );
            const point = {
                clientX: label.x + label.style.text.length * 8 * scale - 1,
                clientY: label.y - 1,
            };
            expect(ref.current?.hitTestMarker(point)).toBe(true);
            expect(ref.current?.hitTestMarker({ ...point, clientX: point.clientX + 8 })).toBe(false);
            act(() => expect(ref.current?.openMarkerEdit(point)).toBe(true));
            expect(ref.current?.beginMarkerDrag({ ...point, button: 0, pointerId: 7 })).toBe(true);
            expect(
                ref.current?.moveMarkerDrag({ clientX: point.clientX + 30, clientY: point.clientY, pointerId: 7 }),
            ).toBe(true);
            expect(onEventMarkerDrag).toHaveBeenCalledWith('yellow-1', 8);
            expect(ref.current?.endMarkerDrag(7)).toBe(true);
        } finally {
            act(() => updateRoastSettings({ fontScalePct: previous }));
        }
    });

    it('uses a short connector as a drag target in callout mode', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDrag = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 50, 80],
                    btActual: [180, 185, 190],
                    currentTimeSec: 80,
                    eventMarkerStyle: 'callout',
                    onEventMarkerDrag,
                    eventMarkers: [
                        {
                            logId: 'yellow',
                            event: 'Yellow',
                            timeSec: 50,
                            timeStr: '0:50',
                            temp: '185°C',
                            color: '#888',
                        },
                    ],
                }),
            );
        });
        convertToPixel.mockImplementation((finder, value) =>
            'yAxisIndex' in finder ? 250 - (value as number) : (value as number) * 10,
        );
        // This point is outside both the dot's radius and the text box's padding.
        const point = { clientX: 509.6, clientY: 51.8 };
        expect(ref.current?.hitTestMarker(point)).toBe(true);
        expect(ref.current?.beginMarkerDrag({ ...point, button: 0, pointerId: 22 })).toBe(true);
        expect(ref.current?.moveMarkerDrag({ ...point, clientX: 519.6, pointerId: 22 })).toBe(true);
        expect(onEventMarkerDrag).toHaveBeenCalledWith('yellow', 51);
    });

    it('keeps the final event label clickable after moving it clear of the right axis', () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    showRoR: true,
                    eventMarkerStyle: 'tempLine',
                    eventMarkers: [
                        {
                            logId: 'yellow-1',
                            event: 'Yellow',
                            timeSec: 60,
                            timeStr: '01:00',
                            temp: '185°C',
                            color: '#888',
                        },
                    ],
                    onEventMarkerEdit: vi.fn(),
                }),
            );
        });
        const option = setOption.mock.calls[setOption.mock.calls.length - 1]?.[0];
        const xAt = (time: number) => 32 + (time / 60) * 936;
        vi.spyOn(chart, 'convertToPixel').mockImplementation((finder, value) => {
            if (Array.isArray(value)) return Number.NaN;
            return 'xAxisIndex' in finder ? xAt(value) : value === option.yAxis[0].max ? 10 : 100;
        });
        const series = option.series.find((item: { id: string }) => item.id === 'event-curve-labels');
        const rendered = series.renderItem(
            { dataIndex: 0, coordSys: { x: 32, y: 10, width: 936, height: 250 } },
            { coord: ([time]: number[]) => [xAt(time), 100], getWidth: chart.getWidth, getHeight: chart.getHeight },
        );
        const label = rendered.children.find((child: { type: string }) => child.type === 'text');
        expect(ref.current?.hitTestMarker({ clientX: label.x + 1, clientY: label.y + 1 })).toBe(true);
        expect(ref.current?.hitTestMarker({ clientX: 990, clientY: label.y + 1 })).toBe(false);
    });

    it('uses scalar coordinate conversion for cursor, drag start, and drag move including zero', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onCursorIdx = vi.fn();
        const onEventMarkerDrag = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        { logId: 'note-1', event: 'Note', timeSec: 5, timeStr: '0:05', temp: '180°C', color: '#888' },
                    ],
                    onCursorIdx,
                    onEventMarkerDrag,
                }),
            );
        });

        act(() => zrHandlers.get('mousemove')?.({ offsetX: 0, offsetY: 20 }));
        expect(onCursorIdx).toHaveBeenLastCalledWith(0);
        expect(ref.current?.hitTestMarker({ clientX: 50, clientY: 20 })).toBe(true);
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 20, pointerId: 4 })).toBe(true);
        expect(ref.current?.moveMarkerDrag({ clientX: 80, clientY: 20, pointerId: 4 })).toBe(true);
        expect(onEventMarkerDrag).toHaveBeenCalledWith('note-1', 8);
        expect(convertToPixel.mock.calls.every(([, value]) => !Array.isArray(value))).toBe(true);
        expect(convertFromPixel.mock.calls.every(([, value]) => !Array.isArray(value))).toBe(true);
    });

    it('moves a marker by the pointer delta when the grab is not on the anchor', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDrag = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        { logId: 'note-1', event: 'Note', timeSec: 5, timeStr: '0:05', temp: '180°C', color: '#888' },
                    ],
                    onEventMarkerDrag,
                }),
            );
        });

        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 59, clientY: 20, pointerId: 11 })).toBe(true);
        expect(ref.current?.moveMarkerDrag({ clientX: 69, clientY: 20, pointerId: 11 })).toBe(true);
        expect(onEventMarkerDrag).toHaveBeenCalledWith('note-1', 6);
    });

    it('drags the turning-point mark', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDrag = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 8],
                    btActual: [180, 185, 190],
                    currentTimeSec: 60,
                    eventMarkerStyle: 'line',
                    turningPoints: [{ timeSec: 5, temp: 90 }],
                    onEventMarkerDrag,
                    onEventMarkerEdit: vi.fn(),
                }),
            );
        });

        expect(ref.current?.hitTestMarker({ clientX: 50, clientY: 20 })).toBe(true);
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 20, pointerId: 3 })).toBe(true);
        expect(ref.current?.moveMarkerDrag({ clientX: 80, clientY: 20, pointerId: 3 })).toBe(true);
        expect(onEventMarkerDrag).toHaveBeenCalledWith('tp', 8);
    });

    it.each(['Drop', 'End'])('does not drag %s on a saved curve', (event) => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDrag = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    savedReview: true,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        { logId: 'drop-1', event, timeSec: 5, timeStr: '0:05', temp: '210°C', color: '#888' },
                    ],
                    onEventMarkerDrag,
                    onEventMarkerEdit: vi.fn(),
                }),
            );
        });
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 20, pointerId: 9 })).toBe(false);
        expect(onEventMarkerDrag).not.toHaveBeenCalled();
    });

    it('does not move a marker while dragging a saved curve', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDrag = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    savedReview: true,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        { logId: 'note-1', event: 'Note', timeSec: 5, timeStr: '0:05', temp: '180°C', color: '#888' },
                    ],
                    onEventMarkerDrag,
                    onEventMarkerEdit: vi.fn(),
                }),
            );
        });
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 20, pointerId: 8 })).toBe(true);
        expect(ref.current?.moveMarkerDrag({ clientX: 80, clientY: 20, pointerId: 8 })).toBe(true);
        expect(onEventMarkerDrag).not.toHaveBeenCalled();
    });

    it('selects finite cursor samples and supports point-symbol hits only inside a plot', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onCursorIdx = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [Number.NaN, 5],
                    btActual: [null, 180],
                    eventMarkerStyle: 'point',
                    eventMarkers: [
                        { logId: 'note-1', event: 'Note', timeSec: 5, timeStr: '0:05', temp: '180°C', color: '#888' },
                    ],
                    onCursorIdx,
                    onEventMarkerDrag: vi.fn(),
                }),
            );
        });

        act(() => zrHandlers.get('mousemove')?.({ offsetX: 50, offsetY: 20 }));
        expect(onCursorIdx).toHaveBeenLastCalledWith(1);
        convertToPixel.mockImplementation((finder, value) =>
            'yAxisIndex' in finder ? 250 - (value as number) : (value as number) * 10,
        );
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 70, pointerId: 5 })).toBe(true);
        expect(ref.current?.hitTestMarker({ clientX: 50, clientY: 301 })).toBe(false);
        chart.containPixel.mockReturnValueOnce(false);
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 150, pointerId: 6 })).toBe(false);
    });

    it.each([
        ['CC', 'Yellow'],
        ['FC', 'FC Start'],
        ['SC', 'FC End'],
    ])('adds %s at the clicked time and closes the form', (label, event) => {
        const onAddNote = vi.fn();
        const onAddEvent = vi.fn();
        const props = { ...baseProps, onAddNote, onAddEvent };
        const openForm = () => {
            act(() =>
                container
                    .querySelector('[tabindex="-1"]')
                    ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 20 })),
            );
        };
        act(() => root.render(createElement(RoastTempChart, props)));
        openForm();
        const input = container.querySelector('#chart-note-input') as HTMLTextAreaElement;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, 'memo');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const button = container.querySelector(`[data-chart-note-event="${event}"]`) as HTMLButtonElement;
        expect(button.textContent).toBe(label);
        expect(button.querySelector('svg')).toBeNull();
        expect(container.querySelector('#chart-note-future-hint')).toBeNull();
        expect(button.disabled).toBe(false);
        const enter = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
        act(() => button.dispatchEvent(enter));
        expect(enter.defaultPrevented).toBe(false);
        expect(onAddNote).not.toHaveBeenCalled();
        act(() => button.click());
        expect(onAddEvent).toHaveBeenCalledWith(event, 9);
        expect(container.querySelector('[data-chart-note-form]')).toBeNull();

        act(() =>
            root.render(
                createElement(RoastTempChart, {
                    ...props,
                    eventMarkers: [{ event, timeSec: 9, timeStr: '0:09', temp: '180°C', color: '#888' }],
                }),
            ),
        );
        openForm();
        const recorded = container.querySelector(`[data-chart-note-event="${event}"]`) as HTMLButtonElement;
        expect(recorded.disabled).toBe(false);
        expect(recorded.querySelector('svg')).not.toBeNull();
        act(() => recorded.click());
        expect(onAddEvent).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-chart-note-form]')).toBeNull();
    });

    it('disables phase marks at future note times', () => {
        const onAddEvent = vi.fn();
        act(() =>
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    currentTimeSec: 6,
                    onAddNote: vi.fn(),
                    onAddEvent,
                }),
            ),
        );
        act(() =>
            container
                .querySelector('[tabindex="-1"]')
                ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 20 })),
        );
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-chart-note-event]');
        expect(buttons).toHaveLength(3);
        expect(container.querySelector('#chart-note-future-hint')).not.toBeNull();
        for (const button of buttons) {
            expect(button.disabled).toBe(true);
            expect(button.getAttribute('aria-describedby')).toBe('chart-note-future-hint');
            act(() => button.click());
        }
        expect(onAddEvent).not.toHaveBeenCalled();
    });

    it('records a Note at the click time even when that time is ahead of the live curve', () => {
        const onAddNote = vi.fn();
        act(() => root.render(createElement(RoastTempChart, { ...baseProps, currentTimeSec: 6, onAddNote })));
        const chartElement = container.querySelector('[tabindex="-1"]') as HTMLDivElement;
        act(() =>
            chartElement.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 90, clientY: 20 }),
            ),
        );
        const input = container.querySelector('#chart-note-input') as HTMLTextAreaElement;
        expect(input).not.toBeNull();

        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
        expect(onAddNote).not.toHaveBeenCalled();
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            setter?.call(input, 'past note');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() =>
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true })),
        );
        expect(onAddNote).not.toHaveBeenCalled();
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
        expect(onAddNote).toHaveBeenCalledWith('past note', 9);
    });

    it('records a Note from a right-click outside the temperature plot when x is on the time axis', () => {
        const onAddNote = vi.fn();
        chart.containPixel.mockReturnValue(false);
        try {
            act(() => root.render(createElement(RoastTempChart, { ...baseProps, currentTimeSec: 60, onAddNote })));
            const chartElement = container.querySelector('[tabindex="-1"]') as HTMLDivElement;
            const openAt = (clientX: number, clientY: number) => {
                act(() =>
                    chartElement.dispatchEvent(
                        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }),
                    ),
                );
            };

            openAt(-40, 800);
            expect(container.querySelector('#chart-note-input')).toBeNull();

            openAt(40, 800);
            const input = container.querySelector('#chart-note-input') as HTMLTextAreaElement;
            expect(input).not.toBeNull();
            act(() => {
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                setter?.call(input, 'under the curve');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            act(() => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
            expect(onAddNote).toHaveBeenCalledWith('under the curve', 4);
        } finally {
            chart.containPixel.mockReturnValue(true);
        }
    });

    it.each([
        ['0', '', '', '', { gas: '0' }],
        ['', '50%', '', '', { airflow: '50%' }],
        ['', '', '0', '', { drum: '0' }],
        ['', '', ' 55.5 ', '', { drum: '55.5' }],
        ['1.', '', '', '', { gas: '1.' }],
        ['1.2 kPa', '30', '55', '색 변화 확인', { gas: '1.2 kPa', airflow: '30', drum: '55' }],
    ])('keeps all fields visible and records manual values %s / %s / %s', (gas, airflow, drum, note, controls) => {
        const onAddNote = vi.fn();
        act(() => root.render(createElement(RoastTempChart, { ...baseProps, onAddNote })));
        act(() =>
            container
                .querySelector('[tabindex="-1"]')
                ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 20 })),
        );
        const form = container.querySelector('[data-chart-note-form]') as HTMLFormElement;
        expect(form.querySelectorAll('input')).toHaveLength(3);
        expect(form.querySelectorAll('textarea')).toHaveLength(1);
        expect(form.querySelectorAll('[aria-pressed]')).toHaveLength(0);
        const setValue = (id: string, value: string) => {
            const input = container.querySelector(id) as HTMLInputElement | HTMLTextAreaElement;
            const proto =
                input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            act(() => {
                Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        setValue('#chart-note-gas', gas);
        setValue('#chart-note-airflow', airflow);
        setValue('#chart-note-drum', drum);
        setValue('#chart-note-input', note);
        const input = container.querySelector('#chart-note-gas') as HTMLInputElement;
        act(() =>
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true })),
        );
        expect(onAddNote).not.toHaveBeenCalled();
        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
        expect(onAddNote).toHaveBeenCalledWith(note, 9, controls);
        expect(container.querySelector('[data-chart-note-form]')).toBeNull();
    });

    it.each([false, true])('uses W1A feedback names and units with the control chart hidden: %s', (hidden) => {
        const onAddNote = vi.fn();
        const data: ControlData = {
            ...controlData(undefined),
            readUnits: [{ heater: '%', fan: 'Pa', drum: 'Hz' }],
            reference: {
                xs: [0, 60],
                heater: [40, 45],
                fan: [30, 35],
                drum: [50, 55],
                readUnits: [{ heater: '%', fan: '%', drum: 'RPM' }],
            },
        };
        act(() =>
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    onAddNote,
                    controlData: hidden ? undefined : data,
                    printControlData: data,
                }),
            ),
        );
        act(() =>
            container
                .querySelector('[tabindex="-1"]')
                ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 20 })),
        );
        const form = container.querySelector('[data-chart-note-form]') as HTMLFormElement;
        for (const [id, label, unit, value] of [
            ['gas', 'Heat', '%', '70'],
            ['airflow', 'Air pressure', 'Pa', '115'],
            ['drum', 'Drum', 'Hz', '52'],
        ]) {
            const input = form.querySelector(`#chart-note-${id}`) as HTMLInputElement;
            expect(input.closest('label')?.textContent).toBe(`${label}${unit}`);
            act(() => replaceMarkerTime(input, value));
        }
        act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(onAddNote).toHaveBeenCalledWith('', 9, { gas: '70', airflow: '115', drum: '52' });
    });

    it('shows only reported machine fields while temperature-only machines retain manual fields', () => {
        const onAddNote = vi.fn();
        const render = (readUnits: NonNullable<ControlData['readUnits']>) => {
            act(() =>
                root.render(
                    createElement(RoastTempChart, {
                        ...baseProps,
                        onAddNote,
                        controlData: { ...controlData(undefined), readUnits },
                    }),
                ),
            );
            act(() =>
                container
                    .querySelector('[tabindex="-1"]')
                    ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 20 })),
            );
        };
        render([{ heater: '%', drum: 'Hz' }]);
        expect(container.querySelector('#chart-note-gas')).not.toBeNull();
        expect(container.querySelector('#chart-note-drum')).not.toBeNull();
        expect(container.querySelector('#chart-note-airflow')).toBeNull();
        render([{}]);
        expect(container.querySelector('#chart-note-airflow')).not.toBeNull();
    });

    it('edits a note mark time and the values that were entered', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerEdit = vi.fn();
        act(() =>
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'manual',
                            event: 'Note',
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#888',
                            note: 'color',
                            gas: '0',
                            airflow: '50%',
                            drum: '55',
                        },
                    ],
                    onEventMarkerEdit,
                    controlData: { ...controlData(undefined), readUnits: [{ heater: '%', fan: 'Pa', drum: 'Hz' }] },
                }),
            ),
        );
        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const form = container.querySelector('[data-chart-marker-edit]') as HTMLFormElement;
        expect(form.textContent).toContain('Gas 0');
        expect((form.querySelector('#chart-marker-gas') as HTMLInputElement).value).toBe('0');
        expect((form.querySelector('#chart-marker-airflow') as HTMLInputElement).value).toBe('50%');
        expect((form.querySelector('#chart-marker-drum') as HTMLInputElement).value).toBe('55');
        expect(form.querySelector('#chart-marker-gas')?.closest('label')?.textContent).toBe('Heat%');
        expect(form.querySelector('#chart-marker-airflow')?.closest('label')?.textContent).toBe('Air pressurePa');
        expect(form.querySelector('#chart-marker-drum')?.closest('label')?.textContent).toBe('DrumHz');
        expect((form.querySelector('#chart-marker-note') as HTMLTextAreaElement).value).toBe('color');
        const time = form.querySelector('#chart-marker-time') as HTMLInputElement;
        act(() => time.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', shiftKey: true })));
        expect(onEventMarkerEdit).not.toHaveBeenCalled();
        act(() => replaceMarkerTime(time, '0:08'));
        act(() => replaceMarkerTime(form.querySelector('#chart-marker-gas') as HTMLInputElement, '1.2 kPa'));
        act(() => time.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
        expect(onEventMarkerEdit).toHaveBeenCalledWith('manual', {
            timeSec: 8,
            note: 'color',
            gas: '1.2 kPa',
            airflow: '50%',
            drum: '55',
            virtual: {},
        });
    });

    it('opens a marker editor on click and saves Heater time and heat value', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerEdit = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'heater-1',
                            event: 'Heater',
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#c00',
                            note: '50%',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit,
                }),
            );
        });

        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const form = container.querySelector('[data-chart-marker-edit]') as HTMLFormElement;
        const time = form.querySelector('#chart-marker-time') as HTMLInputElement;
        const heat = form.querySelector('#chart-marker-heat') as HTMLInputElement;
        expect(time.value).toBe('0:05');
        expect(heat.value).toBe('50');
        expect(form.textContent).toContain('%');
        expect(form.querySelectorAll('input')).toHaveLength(2);

        act(() => replaceMarkerTime(time, '0:08'));
        act(() => replaceMarkerTime(heat, '80'));
        act(() =>
            container
                .querySelector('[data-chart-marker-edit]')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        expect(onEventMarkerEdit).toHaveBeenCalledWith('heater-1', { timeSec: 8, note: '80%' });
    });

    it('saved review edits and deletes a heater mark', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerEdit = vi.fn();
        const onEventMarkerDelete = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    savedReview: true,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'heater-1',
                            event: 'Heater',
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#c00',
                            note: '80%',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit,
                    onEventMarkerDelete,
                }),
            );
        });
        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const form = container.querySelector('[data-chart-marker-edit]') as HTMLFormElement;
        expect((form.querySelector('#chart-marker-heat') as HTMLInputElement).value).toBe('80');
        expect(form.querySelectorAll('input')).toHaveLength(2);
        expect(form.querySelector('[data-chart-marker-delete]')).not.toBeNull();
        const time = form.querySelector('#chart-marker-time') as HTMLInputElement;
        act(() => replaceMarkerTime(time, '0:08'));
        act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(onEventMarkerEdit).toHaveBeenCalledWith('heater-1', { timeSec: 8, note: '80%' });
    });

    it('keeps marker time to digits and seconds 0–60', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerEdit = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 60],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'yellow-1',
                            event: 'Yellow',
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#888',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit,
                }),
            );
        });

        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const time = container.querySelector('#chart-marker-time') as HTMLInputElement;

        act(() => replaceMarkerTime(time, 'a'));
        expect(time.value).toBe('0:05');
        act(() => replaceMarkerTime(time, '1:37'));
        expect(time.value).toBe('1:37');
        act(() => replaceMarkerTime(time, '0:61'));
        expect(time.value).toBe('1:37');
        act(() => replaceMarkerTime(time, '0:60'));
        expect(time.value).toBe('0:60');
        act(() =>
            container
                .querySelector('[data-chart-marker-edit]')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        expect(onEventMarkerEdit).toHaveBeenCalledWith('yellow-1', { timeSec: 60 });
    });

    it('keeps a typed clock instead of filling four slots from the left', () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 800],
                    currentTimeSec: 800,
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'note-1',
                            event: 'Note',
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#888',
                            note: 'hi',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit: vi.fn(),
                }),
            );
        });

        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const time = container.querySelector('#chart-marker-time') as HTMLInputElement;
        act(() => replaceMarkerTime(time, '12:34'));
        expect(time.value).toBe('12:34');
        act(() => replaceMarkerTime(time, '100:00'));
        expect(time.value).toBe('100:00');
        act(() => replaceMarkerTime(time, ''));
        expect(time.value).toBe('');
    });

    it('steps marker time by one second on arrow keys and stops at the event cap', () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 8],
                    currentTimeSec: 8,
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'note-1',
                            event: 'Note',
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#888',
                            note: 'hi',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit: vi.fn(),
                }),
            );
        });

        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const time = container.querySelector('#chart-marker-time') as HTMLInputElement;
        const press = (key: string) => {
            time.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        };

        act(() => press('ArrowUp'));
        expect(time.value).toBe('0:06');
        act(() => press('ArrowDown'));
        act(() => press('ArrowDown'));
        expect(time.value).toBe('0:04');

        act(() => replaceMarkerTime(time, '0:08'));
        act(() => press('ArrowUp'));
        expect(time.value).toBe('0:08');
        act(() => press('ArrowDown'));
        expect(time.value).toBe('0:07');
    });

    it.each(['Note', 'Heater', 'Yellow', 'FC Start', 'FC Rolling', 'FC End'])(
        'deletes %s marker from editor',
        (event) => {
            const ref = createRef<RoastTempChartHandle>();
            const onEventMarkerDelete = vi.fn();
            act(() => {
                root.render(
                    createElement(RoastTempChart, {
                        ...baseProps,
                        ref,
                        xs: [0, 5, 8],
                        eventMarkerStyle: 'line',
                        eventMarkers: [
                            {
                                logId: 'heater-1',
                                event,
                                timeSec: 5,
                                timeStr: '0:05',
                                temp: '180°C',
                                color: '#c00',
                                note: '50%',
                            },
                        ],
                        onEventMarkerDrag: vi.fn(),
                        onEventMarkerEdit: vi.fn(),
                        onEventMarkerDelete,
                    }),
                );
            });

            act(() => {
                expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
            });
            act(() => {
                (container.querySelector('[data-chart-marker-delete]') as HTMLButtonElement).click();
            });
            expect(onEventMarkerDelete).toHaveBeenCalledWith('heater-1');
            expect(container.querySelector('[data-chart-marker-edit]')).toBeNull();
        },
    );

    it('keeps Delete off non-removable marker editors', () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'drop-1',
                            event: 'Drop',
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#888',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit: vi.fn(),
                    onEventMarkerDelete: vi.fn(),
                }),
            );
        });

        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        expect(container.querySelector('[data-chart-marker-edit]')).not.toBeNull();
        expect(container.querySelector('[data-chart-marker-delete]')).toBeNull();
    });

    it('deletes a drum label from the edit form', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDelete = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    xs: [0, 4, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'ctl:drum',
                            event: 'Drum',
                            timeSec: 4,
                            timeStr: '0:04',
                            temp: '',
                            note: '45',
                            color: '#111',
                        },
                    ],
                    onEventMarkerEdit: vi.fn(),
                    onEventMarkerDelete,
                }),
            );
        });
        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 40, clientY: 20 })).toBe(true);
        });
        const button = container.querySelector('[data-chart-marker-delete]') as HTMLButtonElement;
        expect(button).not.toBeNull();
        act(() => button.click());
        expect(onEventMarkerDelete).toHaveBeenCalledWith('ctl:drum');
    });

    it('saved review disables Delete on a turning point', () => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDelete = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    savedReview: true,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'tp-1',
                            event: 'TP',
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '140°C',
                            color: '#888',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit: vi.fn(),
                    onEventMarkerDelete,
                }),
            );
        });
        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const button = container.querySelector('[data-chart-marker-delete]') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        act(() => button.click());
        expect(onEventMarkerDelete).not.toHaveBeenCalled();
    });

    it.each(['FC Start'])('saved review deletes a %s marker', (event) => {
        const ref = createRef<RoastTempChartHandle>();
        const onEventMarkerDelete = vi.fn();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    savedReview: true,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'mark-1',
                            event,
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#888',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit: vi.fn(),
                    onEventMarkerDelete,
                }),
            );
        });
        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        act(() => {
            (container.querySelector('[data-chart-marker-delete]') as HTMLButtonElement).click();
        });
        expect(onEventMarkerDelete).toHaveBeenCalledWith('mark-1');
    });

    it.each(['Drop', 'End'])('saved review does not open %s for drag or edit', (event) => {
        const ref = createRef<RoastTempChartHandle>();
        act(() => {
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    savedReview: true,
                    xs: [0, 5, 8],
                    eventMarkerStyle: 'line',
                    eventMarkers: [
                        {
                            logId: 'drop-1',
                            event,
                            timeSec: 5,
                            timeStr: '0:05',
                            temp: '180°C',
                            color: '#888',
                        },
                    ],
                    onEventMarkerDrag: vi.fn(),
                    onEventMarkerEdit: vi.fn(),
                    onEventMarkerDelete: vi.fn(),
                }),
            );
        });
        expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(false);
        expect(container.querySelector('[data-chart-marker-delete]')).toBeNull();
    });

    it('keeps the read-only chart free of Note writes', () => {
        act(() => root.render(createElement(RoastTempChart, baseProps)));
        const chartElement = container.querySelector('[tabindex="-1"]') as HTMLDivElement;
        act(() =>
            chartElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 20 })),
        );
        expect(container.querySelector('#chart-note-input')).toBeNull();
    });

    it('keeps PDF colors and legend consistent when settings change while fonts load', async () => {
        const previous = getRoastSettings().curveStyles;
        const ref = createRef<RoastTempChartHandle>();
        let resolveFont = () => {};
        const fontReady = new Promise<void>((resolve) => {
            resolveFont = resolve;
        });
        vi.mocked(document.fonts.load).mockReturnValueOnce(fontReady.then(() => []));
        act(() => {
            updateRoastSettings({
                curveStyles: { ...previous, bt: { ...previous.bt, color: '#e53935', lineType: 'dotted' } },
            });
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    temperatureUnit: 'F',
                    showRoRET: true,
                    rorEtActual: [1, null],
                }),
            );
        });
        try {
            const pending = ref.current?.capturePdf();
            expect(document.fonts.load).toHaveBeenCalledWith('400 8px SUIT');
            expect(paper.setOption).not.toHaveBeenCalled();
            act(() => updateRoastSettings({ curveStyles: { ...previous, bt: { ...previous.bt, color: '#00aa00' } } }));
            resolveFont();
            const capture = await pending;
            expect(capture?.chartDataUrl).toBe('data:image/png;base64,qq');
            expect(capture?.legend).toEqual([
                { color: '#e53935', label: 'BT (°F)', lineType: 'solid' },
                { color: expect.any(String), label: 'ET (°F)', lineType: 'solid' },
                { color: expect.any(String), label: 'BT RoR (°F/min)', lineType: 'solid' },
                { color: expect.any(String), label: 'ET RoR (°F/min)', lineType: 'solid' },
            ]);
            const option = paper.setOption.mock.lastCall?.[0];
            expect(option.series.find((series: { name: string }) => series.name === 'BT Actual').lineStyle).toEqual(
                expect.objectContaining({ color: '#e53935', type: 'solid' }),
            );
        } finally {
            act(() => updateRoastSettings({ curveStyles: previous }));
        }
    });

    it('preserves PDF channels and legend regardless of screen channel toggles', async () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() =>
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    showET: false,
                    showRoR: false,
                    showRoRET: false,
                    rorEtActual: [1, null],
                }),
            ),
        );
        const capture = await ref.current?.capturePdf();
        expect(capture?.legend.map((item) => item.label)).toEqual([
            'BT (°C)',
            'ET (°C)',
            'BT RoR (°C/min)',
            'ET RoR (°C/min)',
        ]);
        const option = paper.setOption.mock.lastCall?.[0];
        expect(option.series.map((series: { name: string }) => series.name)).toContain('ET RoR');
        expect(option.series.map((series: { name: string }) => series.name)).toContain('ET Actual');
        expect(option.series.map((series: { name: string }) => series.name)).toContain('RoR');
        act(() =>
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    showET: false,
                    showRoR: false,
                    showRoRET: false,
                    rorEtActual: [null, null],
                }),
            ),
        );
        expect((await ref.current?.capturePdf())?.legend.map((item) => item.label)).toEqual([
            'BT (°C)',
            'ET (°C)',
            'BT RoR (°C/min)',
        ]);
    });

    it('uses the historical fitted range only for PDF and leaves the screen option intact', async () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() =>
            root.render(
                createElement(RoastTempChart, {
                    ...baseProps,
                    ref,
                    tempMinC: 130,
                    tempMaxC: 240,
                    printTempBounds: { tempMinC: 80, tempMaxC: 220 },
                    showET: false,
                    showRoR: false,
                    showRoRET: false,
                }),
            ),
        );
        const screen = setOption.mock.lastCall?.[0];
        const snapshot = screen.yAxis.map((axis: object) => ({ ...axis }));
        expect(screen.yAxis[0]).toMatchObject({ min: 130, max: 240 });
        const calls = setOption.mock.calls.length;
        await ref.current?.capturePdf();
        expect(paper.setOption.mock.lastCall?.[0].yAxis[0]).toMatchObject({ min: 50, max: 250 });
        expect(setOption.mock.calls).toHaveLength(calls);
        expect(screen.yAxis).toEqual(snapshot);
    });

    it('exports saved controls without adding an empty on-screen feedback plot', async () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() =>
            root.render(createElement(RoastTempChart, { ...baseProps, ref, printControlData: controlData([60, 0]) })),
        );
        const screen = chart.setOption.mock.lastCall?.[0];
        expect(screen.grid).toHaveLength(1);
        const capture = await ref.current?.capturePdf();
        expect(paper.setOption.mock.lastCall?.[0].grid).toHaveLength(4);
        expect(chart.setOption.mock.lastCall?.[0]).toBe(screen);
        expect(capture?.legend).toHaveLength(3);
    });

    it('renders at 200 dpi without changing the live chart or its theme', async () => {
        document.documentElement.style.setProperty('--color-sensor-bt', '#ffffff');
        const ref = createRef<RoastTempChartHandle>();
        act(() => root.render(createElement(RoastTempChart, { ...baseProps, ref, controlData: controlData([]) })));
        try {
            const screenOption = chart.setOption.mock.lastCall?.[0];
            expect(screenOption.grid[1].top).toBe('79%');
            expect((await ref.current?.capturePdf())?.chartDataUrl).toBe('data:image/png;base64,qq');
            const element = vi.mocked(echarts.init).mock.lastCall?.[0];
            const pixelRatio = 200 / 72;
            expect(Number.parseFloat(element?.style.width ?? '') * pixelRatio).toBeCloseTo(
                Math.round(roastPdfLayout.chartWidth * pixelRatio),
            );
            expect(Number.parseFloat(element?.style.height ?? '') * pixelRatio).toBeCloseTo(
                Math.round(roastPdfLayout.chartHeight * pixelRatio),
            );
            expect(element?.isConnected).toBe(false);
            const printOption = paper.setOption.mock.lastCall?.[0];
            expect(printOption.grid).toHaveLength(4);
            expect(printOption.grid[0].height).toBeGreaterThan(200);
            expect(
                Number(printOption.grid[1].top) - Number(printOption.grid[0].top) - Number(printOption.grid[0].height),
            ).toBeCloseTo(roastPdfLayout.plotGap + roastPdfLayout.axisSpace);
            expect(
                printOption.series.find((series: { name: string }) => series.name === 'BT Actual').lineStyle.color,
            ).toBe('#009d4c');
            expect(document.documentElement.style.getPropertyValue('--color-sensor-bt')).toBe('#ffffff');
            expect(chart.setOption.mock.lastCall?.[0]).toBe(screenOption);
            expect(chart.dispose).not.toHaveBeenCalled();
            expect(paper.dispose).toHaveBeenCalledOnce();
            expect(paper.getDataURL).toHaveBeenLastCalledWith({
                type: 'png',
                pixelRatio,
                backgroundColor: 'rgba(0,0,0,0)',
            });
        } finally {
            document.documentElement.style.removeProperty('--color-sensor-bt');
        }
    });

    it('removes the temporary canvas when initialization fails', async () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() => root.render(createElement(RoastTempChart, { ...baseProps, ref })));
        vi.mocked(echarts.init).mockImplementationOnce(() => {
            throw new Error('init failed');
        });
        await expect(ref.current?.capturePdf()).rejects.toThrow('init failed');
        expect(document.querySelector('[style*="-9999px"]')).toBeNull();
        expect(chart.dispose).not.toHaveBeenCalled();
    });

    it('disposes the temporary chart after rendering fails and allows another capture', async () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() => root.render(createElement(RoastTempChart, { ...baseProps, ref })));
        paper.setOption.mockImplementationOnce(() => {
            throw new Error('render failed');
        });
        await expect(ref.current?.capturePdf()).rejects.toThrow('render failed');
        expect(paper.dispose).toHaveBeenCalledOnce();
        expect(document.querySelector('[style*="-9999px"]')).toBeNull();
        expect(chart.dispose).not.toHaveBeenCalled();
        expect((await ref.current?.capturePdf())?.chartDataUrl).toBe('data:image/png;base64,qq');
    });
});
