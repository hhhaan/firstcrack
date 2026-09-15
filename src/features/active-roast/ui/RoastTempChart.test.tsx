// @vitest-environment jsdom
import type { ControlData } from '@features/active-roast/lib/chart-option';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastTempChart, type RoastTempChartHandle } from './RoastTempChart';

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
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 20, pointerId: 4 })).toBe(true);
        expect(ref.current?.moveMarkerDrag({ clientX: 80, clientY: 20, pointerId: 4 })).toBe(true);
        expect(onEventMarkerDrag).toHaveBeenCalledWith('note-1', 8);
        expect(convertToPixel.mock.calls.every(([, value]) => !Array.isArray(value))).toBe(true);
        expect(convertFromPixel.mock.calls.every(([, value]) => !Array.isArray(value))).toBe(true);
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
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 1800, pointerId: 5 })).toBe(true);
        chart.containPixel.mockReturnValueOnce(false);
        expect(ref.current?.beginMarkerDrag({ button: 0, clientX: 50, clientY: 500, pointerId: 6 })).toBe(false);
    });

    it('adds a frozen-time Note from chart context and rejects empty or composing Enter', () => {
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
        expect(onAddNote).toHaveBeenCalledWith('past note', 6);
    });

    it('keeps the read-only chart free of Note writes', () => {
        act(() => root.render(createElement(RoastTempChart, baseProps)));
        const chartElement = container.querySelector('[tabindex="-1"]') as HTMLDivElement;
        act(() =>
            chartElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 20 })),
        );
        expect(container.querySelector('#chart-note-input')).toBeNull();
    });
});
