// @vitest-environment jsdom
import { bbpDisplayTime } from '@features/active-roast/lib/bbp-events';
import { CHART_GRID_LEFT, CHART_GRID_RIGHT_WITH_ROR } from '@features/active-roast/lib/chart-config';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { resolveLiveChartView } from '../lib/live-chart-view';
import { type UseChartPipelineParams, type UseChartPipelineReturn, useChartPipeline } from './useChartPipeline';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const point = (time: number) => ({
    time,
    label: '',
    bt: 200,
    et: 210,
    ror: null,
    ror_et: null,
    heater: 0,
    fan: 40,
    drum: 50,
});

describe('continuous chart viewport', () => {
    it('preserves a manually selected real interval at Charge and during growth, then resumes automatic view', () => {
        const root = createRoot(document.createElement('div'));
        let chart: UseChartPipelineReturn | undefined;
        let params: UseChartPipelineParams = {
            livePoints: [point(0), point(119)],
            targetCurvePoints: [],
            xMin: 0,
            xMaxFloor: 900,
            showRoR: true,
            showControlChart: true,
            unit: 'C',
            timelineKey: 'wait-a',
            coordinateOrigin: 1,
        };
        const Probe = () => {
            chart = useChartPipeline(params);
            return null;
        };
        const render = () => act(() => root.render(createElement(Probe)));
        try {
            render();
            act(() => chart?.setZoomRange({ start: 0, end: 100 }));
            params = {
                ...params,
                coordinateOrigin: 120,
                xMin: -119,
                xMaxFloor: 780,
                livePoints: [point(-119), point(0), point(10)],
            };
            render();
            expect(chart?.effectiveZoomRange).toEqual({ start: -119, end: -19 });
            expect(chart?.maxTime).toBe(781);
            params = { ...params, livePoints: [...params.livePoints, point(1000)] };
            render();
            expect(chart?.maxTime).toBeGreaterThanOrEqual(1090);
            expect(chart?.effectiveZoomRange).toEqual({ start: -119, end: -19 });
            act(() => chart?.setZoomRange(null));
            expect(chart?.effectiveZoomRange).toBeNull();
            expect(chart?.visibleControlXs).toEqual([-119, 0, 10, 1000]);
            expect(chart?.visibleXs).toContain(1000);
            params = {
                ...params,
                targetCurvePoints: [{ t: 5000, bt: 200, et: null, ror: null, heater: 0, fan: 0, drum: 0 }],
            };
            const before = chart?.maxTime;
            render();
            expect(chart?.maxTime).toBe(before);
            act(() => chart?.setZoomRange({ start: 100, end: 300 }));
            expect(chart?.effectiveZoomRange).toEqual({ start: 100, end: 300 });
            params = {
                ...params,
                timelineKey: 'wait-b',
                coordinateOrigin: 0,
                xMin: 0,
                xMaxFloor: 900,
                livePoints: [point(0)],
            };
            render();
            expect(chart?.maxTime).toBe(900);
            expect(chart?.effectiveZoomRange).toBeNull();
        } finally {
            act(() => root.unmount());
        }
    });
});

it('keeps samples, control values, and event times aligned across rolling BBP, reference arrival, and Charge', () => {
    const root = createRoot(document.createElement('div'));
    let chart: UseChartPipelineReturn | undefined;
    const sample = (t: number) => ({ t, bt: 200 + t / 100, et: 210, heater: t / 10, fan: 40, drum: 50 });
    const samples = [0, 300, 400, 500, 600, 900, 960, 1200].map(sample);
    const reference = [0, 299, 300, 301, 600, 720].map((t) => ({ ...sample(t), ror: 1 }));
    let latest = 900;
    let target: typeof reference = [];
    let charged = false;
    const view = () =>
        resolveLiveChartView({
            bbpActive: !charged,
            charged,
            livePoints: charged ? [point(0)] : [],
            bbpPoints: samples.filter((p) => p.t <= latest),
            roastTarget: target,
            bbpTarget: [],
            bbpTargetError: false,
            bbpCapture: charged
                ? {
                      sessionId: 'a',
                      generation: 'a',
                      startMs: 1000,
                      chargeMs: 1201000,
                      recording: true,
                      points: samples,
                      events: [],
                  }
                : null,
        });
    const Probe = () => {
        const current = view();
        chart = useChartPipeline({
            livePoints: current.livePoints,
            targetCurvePoints: current.targetPoints,
            xMin: current.xMin,
            xMaxFloor: current.xMaxFloor,
            xMaxFixed: current.xMaxFixed,
            coordinateOrigin: current.axisOrigin,
            timelineKey: 'wait-a',
            showRoR: true,
            showControlChart: true,
            unit: 'C',
        });
        return null;
    };
    const render = () => act(() => root.render(createElement(Probe)));
    const check = (start: number, end: number, times: number[]) => {
        expect(chart?.effectiveZoomRange).toEqual({ start, end });
        expect(chart?.visibleControlXs).toEqual(times);
        expect(chart?.visibleChartData.filter((p) => p.btActual != null).map((p) => p.time)).toEqual(times);
        expect(chart?.visibleHeatPower).toEqual([30, 40, 50, 60]);
        expect(bbpDisplayTime(400, view().eventTimeOrigin)).toBe(times[1]);
    };
    try {
        render();
        expect(chart?.maxTime).toBe(900);
        act(() => chart?.setZoomRange({ start: 300, end: 600 }));
        check(300, 600, [300, 400, 500, 600]);
        latest = 960;
        render();
        check(240, 540, [240, 340, 440, 540]);
        target = reference;
        render();
        expect(chart?.maxTime).toBe(1620);
        check(240, 540, [240, 340, 440, 540]);
        latest = 1200;
        render();
        check(0, 300, [0, 100, 200, 300]);
        charged = true;
        render();
        check(-900, -600, [-900, -800, -700, -600]);
        expect(chart?.targetSeries.filter((p) => p.time >= 0).map((p) => p.time)).toEqual(reference.map((p) => p.t));
        act(() => chart?.setZoomRange(null));
        expect(chart?.maxTime).toBeGreaterThan(0);
    } finally {
        act(() => root.unmount());
    }
});

it('returns an expired BBP zoom to the fixed automatic viewport and allows zooming again', () => {
    const root = createRoot(document.createElement('div'));
    let chart: UseChartPipelineReturn | undefined;
    let origin = 0;
    const Probe = () => {
        chart = useChartPipeline({
            livePoints: [point(0), point(900)],
            targetCurvePoints: [],
            xMin: 0,
            xMaxFloor: 900,
            xMaxFixed: 900,
            coordinateOrigin: origin,
            timelineKey: 'a',
            showRoR: true,
            showControlChart: true,
            unit: 'C',
        });
        return null;
    };
    const render = () => act(() => root.render(createElement(Probe)));
    try {
        render();
        act(() => chart?.setZoomRange({ start: 0, end: 100 }));
        origin = 60;
        render();
        expect(chart?.effectiveZoomRange).toEqual({ start: 0, end: 40 });
        origin = 100;
        render();
        expect(chart?.effectiveZoomRange).toBeNull();
        expect(chart?.minTime).toBe(0);
        expect(chart?.maxTime).toBe(900);
        act(() => chart?.setZoomRange({ start: 100, end: 300 }));
        expect(chart?.effectiveZoomRange).toEqual({ start: 100, end: 300 });
        origin = 200;
        render();
        expect(chart?.effectiveZoomRange).toEqual({ start: 0, end: 200 });
        act(() => chart?.setZoomRange(null));
        expect(chart?.maxTime).toBe(900);
    } finally {
        act(() => root.unmount());
    }
});

it.each([
    { label: 'ET RoR only', showRoR: false, showRoRET: true },
    { label: 'BT RoR only', showRoR: true, showRoRET: false },
])('anchors wheel zoom to the rendered right-axis plot for $label', ({ showRoR, showRoRET }) => {
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        },
    );
    const host = document.createElement('div');
    const root = createRoot(host);
    let chart: UseChartPipelineReturn | undefined;
    const Probe = () => {
        chart = useChartPipeline({
            livePoints: [point(0), point(100)],
            targetCurvePoints: [],
            xMin: 0,
            xMaxFloor: 900,
            showRoR,
            showRoRET,
            showControlChart: false,
            unit: 'C',
        });
        return createElement('div', { ref: chart.chartAreaRef });
    };
    try {
        act(() => root.render(createElement(Probe)));
        const area = host.firstElementChild as HTMLDivElement;
        vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 300));
        const center = CHART_GRID_LEFT + (1000 - CHART_GRID_LEFT - CHART_GRID_RIGHT_WITH_ROR) / 2;
        act(() => area.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: center, cancelable: true })));
        expect(chart?.effectiveZoomRange?.start).toBeCloseTo(90);
        expect(chart?.effectiveZoomRange?.end).toBeCloseTo(810);
    } finally {
        act(() => root.unmount());
        vi.unstubAllGlobals();
    }
});
