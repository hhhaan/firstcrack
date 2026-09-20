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
        expect(ref.current?.hitTestMarker({ clientX: 50, clientY: 20 })).toBe(true);
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
        const time = container.querySelector('#chart-marker-time') as HTMLInputElement;
        const heat = container.querySelector('#chart-marker-heat') as HTMLInputElement;
        expect(time.value).toBe('0:05');
        expect(heat.value).toBe('50');
        expect(heat.disabled).toBe(true);
        expect(heat.readOnly).toBe(true);

        act(() => {
            const timeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            timeSetter?.call(time, '0:08');
            time.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() =>
            container
                .querySelector('[data-chart-marker-edit]')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        expect(onEventMarkerEdit).toHaveBeenCalledWith('heater-1', { timeSec: 8 });
        expect(onEventMarkerEdit.mock.calls[0][1].note).toBeUndefined();
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
        const setTime = (value: string) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(time, value);
            time.dispatchEvent(new Event('input', { bubbles: true }));
        };

        act(() => setTime('0:05a'));
        expect(time.value).toBe('0:05');
        act(() => setTime('0:61'));
        expect(time.value).toBe('0:05');
        act(() => setTime('0:60'));
        expect(time.value).toBe('0:60');
        act(() =>
            container
                .querySelector('[data-chart-marker-edit]')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
        expect(onEventMarkerEdit).toHaveBeenCalledWith('yellow-1', { timeSec: 60 });
    });

    it('deletes a Heater marker from the editor', () => {
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
                            event: 'Heater',
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
    });

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

    it('keeps the read-only chart free of Note writes', () => {
        act(() => root.render(createElement(RoastTempChart, baseProps)));
        const chartElement = container.querySelector('[tabindex="-1"]') as HTMLDivElement;
        act(() =>
            chartElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 20 })),
        );
        expect(container.querySelector('#chart-note-input')).toBeNull();
    });
});
