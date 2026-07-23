import { CHART_GRID_RIGHT, CHART_GRID_RIGHT_WITH_ROR } from '@features/active-roast/lib/chart-config';
import {
    buildCompareChartOption,
    type CompareChartSeries,
    compareChartXMax,
} from '@features/active-roast/lib/chart-option';
import { useChartZoom } from '@features/active-roast/model/useChartZoom';
import { useThemeStore } from '@shared/store/theme';
import * as echarts from 'echarts';
import { useEffect, useMemo, useRef } from 'react';

export type CompareSeries = CompareChartSeries;

interface CompareMultiChartProps {
    series: CompareSeries[];
    height?: number;
    showRoR?: boolean;
}

export const CompareMultiChart = ({ series, height = 320, showRoR = true }: CompareMultiChartProps) => {
    const elRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

    const active = useMemo(() => series.filter((s) => s.visible !== false && s.points.length > 0), [series]);

    const xMax = useMemo(() => compareChartXMax(active), [active]);
    const {
        setZoomRange,
        effectiveZoomRange,
        isChartDragging,
        chartAreaRef,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    } = useChartZoom(xMax, 0, showRoR ? CHART_GRID_RIGHT_WITH_ROR : CHART_GRID_RIGHT);

    // 세션 토글로 전체 범위가 바뀌면 이전 줌이 무효 — 리셋
    // biome-ignore lint/correctness/useExhaustiveDependencies: xMax 변경 시에만 리셋
    useEffect(() => {
        setZoomRange(null);
    }, [xMax, setZoomRange]);

    // useQueries returns fresh array identities every render — fingerprint the
    // content so setOption only runs when the data actually changed.
    const fingerprint = useMemo(
        () =>
            `${active
                .map((s) => {
                    const last = s.points[s.points.length - 1];
                    return `${s.id}:${s.points.length}:${last?.t ?? 0}:${last?.bt ?? 0}:${s.color}`;
                })
                .join(
                    '|',
                )}|ror:${showRoR}|${resolvedTheme}|zoom:${effectiveZoomRange?.start ?? ''}:${effectiveZoomRange?.end ?? ''}`,
        [active, showRoR, resolvedTheme, effectiveZoomRange],
    );

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;
        const chart = echarts.init(el, undefined, { renderer: 'canvas', useDirtyRect: false });
        chartRef.current = chart;

        const lastSize = { w: 0, h: 0 };
        const ro = new ResizeObserver(() => {
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            if (w <= 0 || h <= 0 || (lastSize.w === w && lastSize.h === h)) return;
            lastSize.w = w;
            lastSize.h = h;
            chart.resize();
        });
        ro.observe(el);

        return () => {
            ro.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: fingerprint covers series content
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.setOption(buildCompareChartOption(active, showRoR, effectiveZoomRange), { notMerge: true });
    }, [fingerprint]);

    return (
        <div
            ref={chartAreaRef}
            className={`w-full ${
                effectiveZoomRange
                    ? isChartDragging
                        ? 'cursor-grabbing select-none touch-none'
                        : 'cursor-grab touch-none'
                    : ''
            }`}
            style={{ height }}
            // wheel: native listener on chartAreaRef (useChartZoom) — ECharts steals bubble wheel
            onPointerDownCapture={handleChartPointerDown}
            onPointerMoveCapture={handleChartPointerMove}
            onPointerUpCapture={endChartDrag}
            onPointerCancelCapture={endChartDrag}
        >
            <div ref={elRef} className="h-full w-full" />
        </div>
    );
};
