// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
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
