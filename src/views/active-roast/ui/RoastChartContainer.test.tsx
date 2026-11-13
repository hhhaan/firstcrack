// @vitest-environment jsdom
import { act, type ComponentProps, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastChartContainer } from './RoastChartContainer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const marker = vi.hoisted(() => ({
    begin: vi.fn(() => false),
    move: vi.fn(() => false),
    end: vi.fn(() => false),
    hitTest: vi.fn(() => false),
    openEdit: vi.fn(() => false),
    props: null as { hideChargeLabel?: boolean; xViewMin?: number; xViewMax?: number } | null,
}));

vi.mock('@features/active-roast/ui/RoastTempChart', async () => {
    const React = await import('react');
    return {
        RoastTempChart: React.forwardRef((props: { hideChargeLabel?: boolean }, ref) => {
            marker.props = props;
            React.useImperativeHandle(ref, () => ({
                beginMarkerDrag: marker.begin,
                moveMarkerDrag: marker.move,
                endMarkerDrag: marker.end,
                hitTestMarker: marker.hitTest,
                openMarkerEdit: marker.openEdit,
            }));
            return React.createElement(
                'div',
                { 'data-testid': 'chart' },
                React.createElement('form', { 'data-chart-note-form': true }, React.createElement('input')),
            );
        }),
    };
});

vi.mock('./ChartLegend', () => ({ ChartLegend: () => null }));

const pointer = (type: string, pointerId: number, button = 0, clientX = 50, clientY = 20) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX, clientY });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    return event;
};

describe('RoastChartContainer pointer ownership', () => {
    let container: HTMLDivElement;
    let root: Root;
    const panDown = vi.fn();
    const panMove = vi.fn();
    const panEnd = vi.fn();

    const render = (overrides: Partial<ComponentProps<typeof RoastChartContainer>> = {}) => {
        act(() => {
            root.render(
                createElement(RoastChartContainer, {
                    chartAreaRef: { current: null },
                    mainChartHeight: 300,
                    minTime: 0,
                    maxTime: 900,
                    effectiveZoomRange: { start: 0, end: 60 },
                    isChartDragging: false,
                    handleChartPointerDown: panDown,
                    handleChartPointerMove: panMove,
                    endChartDrag: panEnd,
                    xs: [0, 60],
                    btActual: [180, 190],
                    etActual: [200, 210],
                    rorActual: [5, 4],
                    rorEtActual: [],
                    targetXs: [],
                    targetBt: [],
                    showTargetCurve: false,
                    showET: true,
                    showRoR: true,
                    showRoRET: false,
                    tempMinC: 50,
                    tempMaxC: 250,
                    rorYMin: -10,
                    rorYMax: 40,
                    elapsed: 60,
                    charged: true,
                    eventMarkerStyle: 'line',
                    eventMarkers: [],
                    turningPoints: [],
                    phaseSegments: [],
                    unit: 'C',
                    onCursorIdx: vi.fn(),
                    onEventMarkerDrag: vi.fn(),
                    ...overrides,
                }),
            );
        });
    };

    beforeEach(() => {
        marker.begin.mockReset().mockReturnValue(false);
        marker.move.mockReset().mockReturnValue(false);
        marker.end.mockReset().mockReturnValue(false);
        marker.hitTest.mockReset().mockReturnValue(false);
        marker.openEdit.mockReset().mockReturnValue(false);
        panDown.mockReset();
        panMove.mockReset();
        panEnd.mockReset();
        Object.defineProperties(HTMLElement.prototype, {
            setPointerCapture: { configurable: true, value: vi.fn() },
            releasePointerCapture: { configurable: true, value: vi.fn() },
            hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        render();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
        Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
        Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
        vi.restoreAllMocks();
    });

    it('shows the Charge label once the batch is charged, with no BBP range', () => {
        expect(marker.props?.hideChargeLabel).toBe(false);
    });

    it('hides the Charge label before Charge when no BBP is drawn', () => {
        render({ charged: false });
        expect(marker.props?.hideChargeLabel).toBe(true);
    });

    it('keeps the Charge label on a saved-curve review and on a drawn BBP', () => {
        render({ charged: false, savedReview: true });
        expect(marker.props?.hideChargeLabel).toBe(false);
        render({ charged: false, bbpRange: { start: -120, end: 0 } });
        expect(marker.props?.hideChargeLabel).toBe(false);
    });

    it('keeps automatic BBP bounds exact when subsecond measurements do not provide axis sentinels', () => {
        render({ effectiveZoomRange: null, xs: [0.111, 899.5], minTime: 0, maxTime: 900 });
        expect(marker.props?.xViewMin).toBe(0);
        expect(marker.props?.xViewMax).toBe(900);
    });

    it('keeps the joined negative-time automatic bounds after Charge', () => {
        render({ effectiveZoomRange: null, xs: [-119.9, 0], minTime: -120, maxTime: 780 });
        expect(marker.props?.xViewMin).toBe(-120);
        expect(marker.props?.xViewMax).toBe(780);
    });

    it('uses the manual zoom bounds ahead of the automatic viewport', () => {
        render({ effectiveZoomRange: { start: -100, end: -20 }, minTime: -120, maxTime: 780 });
        expect(marker.props?.xViewMin).toBe(-100);
        expect(marker.props?.xViewMax).toBe(-20);
    });

    it('routes a claimed marker pointer without starting pan and clears on release', () => {
        marker.begin.mockReturnValue(true);
        marker.move.mockReturnValue(true);
        marker.end.mockReturnValue(true);
        const surface = container.querySelector('[role="region"]') as HTMLDivElement;

        act(() => surface.dispatchEvent(pointer('pointerdown', 7)));
        act(() => surface.dispatchEvent(pointer('pointermove', 7, 0, 80)));
        act(() => surface.dispatchEvent(pointer('pointerup', 7, 0, 80)));

        expect(marker.begin).toHaveBeenCalledOnce();
        expect(marker.move).toHaveBeenCalledOnce();
        expect(marker.end).toHaveBeenCalledWith(7);
        expect(panDown).not.toHaveBeenCalled();
        expect(panMove).not.toHaveBeenCalled();
        expect(panEnd).not.toHaveBeenCalled();
        expect(marker.openEdit).not.toHaveBeenCalled();
    });

    it('opens marker edit on click without drag', () => {
        marker.begin.mockReturnValue(true);
        marker.end.mockReturnValue(true);
        marker.openEdit.mockReturnValue(true);
        const surface = container.querySelector('[role="region"]') as HTMLDivElement;

        act(() => surface.dispatchEvent(pointer('pointerdown', 7)));
        act(() => surface.dispatchEvent(pointer('pointermove', 7)));
        act(() => surface.dispatchEvent(pointer('pointerup', 7)));

        expect(marker.move).not.toHaveBeenCalled();
        expect(marker.openEdit).toHaveBeenCalledOnce();
        expect(panDown).not.toHaveBeenCalled();
    });

    it('leaves blank-space pointers with the existing pan handlers', () => {
        const surface = container.querySelector('[role="region"]') as HTMLDivElement;
        act(() => surface.dispatchEvent(pointer('pointerdown', 8)));
        act(() => surface.dispatchEvent(pointer('pointermove', 8)));
        act(() => surface.dispatchEvent(pointer('pointerup', 8)));
        expect(panDown).toHaveBeenCalledOnce();
        expect(panMove).toHaveBeenCalledOnce();
        expect(panEnd).toHaveBeenCalledOnce();
    });

    it.each(['pointercancel', 'lostpointercapture'])('clears marker ownership on %s', (type) => {
        marker.begin.mockReturnValue(true);
        marker.end.mockReturnValue(true);
        const surface = container.querySelector('[role="region"]') as HTMLDivElement;
        act(() => surface.dispatchEvent(pointer('pointerdown', 10)));
        act(() => surface.dispatchEvent(pointer(type, 10)));
        act(() => surface.dispatchEvent(pointer('pointermove', 10)));
        expect(marker.end).toHaveBeenCalledWith(10);
        expect(panMove).toHaveBeenCalledOnce();
        expect(marker.openEdit).not.toHaveBeenCalled();
    });

    it('uses pointer cursor while a marker is being dragged', () => {
        marker.begin.mockReturnValue(true);
        marker.move.mockReturnValue(true);
        marker.end.mockReturnValue(true);
        const surface = container.querySelector('[role="region"]') as HTMLDivElement;

        expect(surface.className).toContain('cursor-grab');
        act(() => surface.dispatchEvent(pointer('pointerdown', 7)));
        expect(surface.className).toContain('cursor-pointer');
        expect(surface.className).not.toContain('cursor-grab');
        act(() => surface.dispatchEvent(pointer('pointerup', 7)));
        expect(surface.className).toContain('cursor-grab');
        expect(surface.className).not.toContain('cursor-pointer');
    });

    it('uses pointer cursor when hovering a draggable marker', () => {
        marker.hitTest.mockReturnValue(true);
        const surface = container.querySelector('[role="region"]') as HTMLDivElement;

        act(() => surface.dispatchEvent(pointer('pointermove', 3)));
        expect(surface.className).toContain('cursor-pointer');
        expect(surface.className).not.toContain('cursor-grab');

        marker.hitTest.mockReturnValue(false);
        act(() => surface.dispatchEvent(pointer('pointermove', 3)));
        expect(surface.className).toContain('cursor-grab');
        expect(surface.className).not.toContain('cursor-pointer');
    });

    it('does not start chart interactions from the Note form', () => {
        const input = container.querySelector('[data-chart-note-form] input') as HTMLInputElement;
        act(() => input.dispatchEvent(pointer('pointerdown', 9)));
        expect(marker.begin).not.toHaveBeenCalled();
        expect(panDown).not.toHaveBeenCalled();
    });
});
