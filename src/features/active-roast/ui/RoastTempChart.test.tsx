// @vitest-environment jsdom

import type { ControlData } from '@features/active-roast/lib/chart-option';
import { getRoastSettings, updateRoastSettings } from '@features/active-roast/model/settings';
import { logger } from '@shared/lib/logger';
import * as echarts from 'echarts';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastTempChart, type RoastTempChartHandle } from './RoastTempChart';

const dispatchTimeInput = (input: HTMLInputElement, data: string, inputType = 'insertText') => {
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data, inputType }));
};

const typeMarkerTime = (input: HTMLInputElement, data: string, inputType = 'insertText') => {
    input.focus();
    dispatchTimeInput(input, data, inputType);
};

const replaceMarkerTime = (input: HTMLInputElement, data: string) => {
    input.focus();
    input.setSelectionRange(0, input.value.length);
    dispatchTimeInput(input, data);
};

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { chart, convertFromPixel, convertToPixel, setOption, zrHandlers } = vi.hoisted(() => {
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
    return { chart, convertFromPixel, convertToPixel, setOption, zrHandlers };
});

vi.mock('echarts', () => ({ init: vi.fn(() => chart) }));

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
                        eventMarkerStyle: 'tempLine',
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
                return 'yAxisIndex' in finder && value === option.yAxis[0].max ? 0 : value * 10;
            });
            const series = option.series.find((s: { id: string }) => s.id === 'event-curve-labels');
            const rendered = series.renderItem(
                { dataIndex: 0, coordSys: { x: 0, y: 0, width: 1000, height: 3000 } },
                { coord: ([x, y]: number[]) => [x * 10, y * 10], getWidth: () => 1000, getHeight: chart.getHeight },
            );
            const label = rendered.children.find(
                (child: { type: string; style?: { text?: string } }) =>
                    child.type === 'text' && child.style?.text?.startsWith('Yellow'),
            );
            const reference = rendered.children.find(
                (child: { type: string; style?: { text?: string } }) =>
                    child.type === 'text' && child.style?.text?.startsWith('Heater'),
            );
            const scale = fontScalePct / 100;
            expect(label.style.text).toBe('Yellow|00:05|185.0°C');
            expect(label.style.font).toBe(`600 ${10 * scale}px monospace`);
            expect(label.x).toBe(50 + 4 * scale);
            expect(reference.y).toBe(8 * scale);
            expect(label.y).toBeCloseTo(24 * scale);
            expect(ref.current?.hitTestMarker({ clientX: label.x + 100 * scale, clientY: reference.y + 1 })).toBe(
                false,
            );
            const point = {
                clientX: label.x + label.style.text.length * 6 * scale - 1,
                clientY: label.y + 1,
            };
            expect(ref.current?.hitTestMarker(point)).toBe(true);
            expect(ref.current?.hitTestMarker({ ...point, clientX: point.clientX + 6 })).toBe(false);
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
        convertToPixel.mockReturnValueOnce(50).mockReturnValueOnce(250);
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 250, pointerId: 5 })).toBe(true);
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

    it('edits a note mark with time only', () => {
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
                }),
            ),
        );
        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const form = container.querySelector('[data-chart-marker-edit]') as HTMLFormElement;
        expect(form.textContent).toContain('Gas 0');
        expect(form.querySelector('#chart-marker-gas')).toBeNull();
        expect(form.querySelector('#chart-marker-airflow')).toBeNull();
        expect(form.querySelector('#chart-marker-drum')).toBeNull();
        expect(form.querySelector('#chart-marker-note')).toBeNull();
        expect(form.querySelectorAll('input')).toHaveLength(1);
        const time = form.querySelector('#chart-marker-time') as HTMLInputElement;
        act(() => time.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', shiftKey: true })));
        expect(onEventMarkerEdit).not.toHaveBeenCalled();
        act(() => replaceMarkerTime(time, '0:08'));
        act(() => time.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
        expect(onEventMarkerEdit).toHaveBeenCalledWith('manual', { timeSec: 8 });
    });

    it('opens a marker editor on click and saves Heater time but not heat value', () => {
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
        expect(time.value).toBe('0:05');
        expect(form.querySelector('#chart-marker-heat')).toBeNull();
        expect(form.querySelectorAll('input')).toHaveLength(1);

        act(() => replaceMarkerTime(time, '0:08'));
        act(() =>
            container
                .querySelector('[data-chart-marker-edit]')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        expect(onEventMarkerEdit).toHaveBeenCalledWith('heater-1', { timeSec: 8 });
        expect(onEventMarkerEdit.mock.calls[0][1].note).toBeUndefined();
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
        expect(form.querySelector('#chart-marker-heat')).toBeNull();
        expect(form.querySelectorAll('input')).toHaveLength(1);
        expect(form.querySelector('[data-chart-marker-delete]')).not.toBeNull();
        const time = form.querySelector('#chart-marker-time') as HTMLInputElement;
        act(() => replaceMarkerTime(time, '0:08'));
        act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(onEventMarkerEdit).toHaveBeenCalledWith('heater-1', { timeSec: 8 });
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

        act(() => typeMarkerTime(time, 'a'));
        expect(time.value).toBe('0:05');
        act(() => replaceMarkerTime(time, '0:61'));
        expect(time.value).toBe('00:60');
        act(() => replaceMarkerTime(time, '0:60'));
        expect(time.value).toBe('00:60');
        act(() =>
            container
                .querySelector('[data-chart-marker-edit]')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        expect(onEventMarkerEdit).toHaveBeenCalledWith('yellow-1', { timeSec: 60 });
    });

    it('turns typed 1234 into 12:34 and leaves the caret after the seconds', () => {
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
        act(() => {
            time.focus();
            time.setSelectionRange(0, time.value.length);
            dispatchTimeInput(time, '', 'deleteContentBackward');
        });
        expect(time.value).toBe('00:00');
        act(() => typeMarkerTime(time, '1'));
        act(() => typeMarkerTime(time, '2'));
        expect(time.value).toBe('12:00');
        expect(time.selectionStart).toBe(3);
        act(() => typeMarkerTime(time, '3'));
        act(() => typeMarkerTime(time, '4'));
        expect(time.value).toBe('12:34');
        expect(time.selectionStart).toBe(5);
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

    it('keeps a marker time edit that skipped beforeinput and reports it once', () => {
        const capture = vi.spyOn(logger, 'capture').mockImplementation(() => {});
        const ref = createRef<RoastTempChartHandle>();
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
                    onEventMarkerEdit: vi.fn(),
                }),
            );
        });
        act(() => {
            expect(ref.current?.openMarkerEdit({ clientX: 50, clientY: 20 })).toBe(true);
        });
        const time = container.querySelector('#chart-marker-time') as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        act(() => {
            setter?.call(time, '9:00');
            time.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(time.value).toBe('9:00');
        act(() => {
            setter?.call(time, '9:01');
            time.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(capture).toHaveBeenCalledOnce();
        capture.mockRestore();
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

    it('exports the canvas as a PNG data URL', () => {
        const ref = createRef<RoastTempChartHandle>();
        act(() => root.render(createElement(RoastTempChart, { ...baseProps, ref })));
        expect(ref.current?.getDataURL()).toBe('data:image/png;base64,qq');
        expect(chart.getDataURL).toHaveBeenCalledWith({
            type: 'png',
            pixelRatio: 2,
            backgroundColor: '#ffffff',
        });
    });

    it('re-renders at print density with legible light colors and both grids, without changing the screen theme', () => {
        document.documentElement.style.setProperty('--color-sensor-bt', '#ffffff');
        const ref = createRef<RoastTempChartHandle>();
        act(() => root.render(createElement(RoastTempChart, { ...baseProps, ref, controlData: controlData([]) })));
        const screenOption = chart.setOption.mock.calls[chart.setOption.mock.calls.length - 1]?.[0];
        expect(screenOption.grid[1].top).toBe('79%');
        expect(ref.current?.getDataURL({ width: 2000, height: 1200 })).toBe('data:image/png;base64,qq');
        const init = vi.mocked(echarts.init);
        const element = init.mock.calls[init.mock.calls.length - 1]?.[0];
        expect(element?.style.width).toBe('1000px');
        expect(element?.style.height).toBe('600px');
        expect(element?.isConnected).toBe(false);
        const printOption = chart.setOption.mock.calls[chart.setOption.mock.calls.length - 1]?.[0];
        expect(printOption.grid).toHaveLength(2);
        expect(printOption.grid[1].top).toBe('65%');
        expect(printOption.series.find((s: { name: string }) => s.name === 'BT Actual').lineStyle.color).toBe(
            '#009d4c',
        );
        expect(document.documentElement.style.getPropertyValue('--color-sensor-bt')).toBe('#ffffff');
        document.documentElement.style.removeProperty('--color-sensor-bt');
        expect(chart.getDataURL).toHaveBeenLastCalledWith({
            type: 'png',
            pixelRatio: 2,
            backgroundColor: '#ffffff',
        });
    });
});
