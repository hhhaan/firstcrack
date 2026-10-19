import { useRoastSettings } from '@features/active-roast';
import { CHART_GRID_RIGHT, CHART_GRID_RIGHT_WITH_ROR } from '@features/active-roast/lib/chart-config';
import {
    buildCompareChartOption,
    type CompareChartSeries,
    compareChannels,
    compareChartXMax,
    compareExtraAxisWidth,
} from '@features/active-roast/lib/chart-option';
import { useChartZoom } from '@features/active-roast/model/useChartZoom';
import { ChartZoomSurface } from '@features/active-roast/ui/ChartZoomSurface';
import { useThemeStore } from '@shared/store/theme';
import * as echarts from 'echarts';
import { useEffect, useMemo, useRef, useState } from 'react';

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
    const temperatureUnit = useRoastSettings().temperatureUnit;
    const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(() => new Set());
    const active = useMemo(() => series.filter((s) => s.visible !== false && s.points.length > 0), [series]);
    const channels = useMemo(
        () => compareChannels(series, temperatureUnit).filter((channel) => showRoR || channel.kind !== 'ror'),
        [series, temperatureUnit, showRoR],
    );
    const channelKeys = useMemo(
        () => channels.filter((channel) => !hiddenChannels.has(channel.key)).map((channel) => channel.key),
        [channels, hiddenChannels],
    );
    const plottedChannels = useMemo(
        () => compareChannels(active, temperatureUnit).filter((channel) => channelKeys.includes(channel.key)),
        [active, temperatureUnit, channelKeys],
    );
    const hasRoR = plottedChannels.some((channel) => channel.kind === 'ror');
    const rightMargin =
        (hasRoR ? CHART_GRID_RIGHT_WITH_ROR : CHART_GRID_RIGHT) + compareExtraAxisWidth(plottedChannels);

    const xMax = useMemo(() => compareChartXMax(active), [active]);
    const {
        setZoomRange,
        effectiveZoomRange,
        chartAreaRef,
        isChartDragging,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    } = useChartZoom(xMax, 0, rightMargin);

    // 세션 토글로 전체 범위가 바뀌면 이전 줌이 무효 — 리셋
    // biome-ignore lint/correctness/useExhaustiveDependencies: xMax 변경 시에만 리셋
    useEffect(() => {
        setZoomRange(null);
    }, [xMax, setZoomRange]);

    // useQueries returns fresh array identities every render — fingerprint the
    // content so setOption only runs when the data actually changed.
    const dataFingerprint = useMemo(() => JSON.stringify(active), [active]);
    const fingerprint = useMemo(
        () =>
            `${dataFingerprint}|channels:${JSON.stringify(channelKeys)}|ror:${showRoR}|${resolvedTheme}|unit:${temperatureUnit}|zoom:${effectiveZoomRange?.start ?? ''}:${effectiveZoomRange?.end ?? ''}`,
        [dataFingerprint, channelKeys, showRoR, resolvedTheme, temperatureUnit, effectiveZoomRange],
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
        const xView =
            effectiveZoomRange && effectiveZoomRange.start < effectiveZoomRange.end
                ? effectiveZoomRange
                : { start: 0, end: xMax };
        chart.setOption(buildCompareChartOption(active, showRoR, xView, temperatureUnit, channelKeys), {
            notMerge: true,
        });
    }, [fingerprint]);

    return (
        <div>
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-secondary">
                {channels.map((channel) => (
                    <label key={channel.key} className="inline-flex cursor-pointer items-center gap-1">
                        <input
                            type="checkbox"
                            checked={!hiddenChannels.has(channel.key)}
                            onChange={() =>
                                setHiddenChannels((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(channel.key)) next.delete(channel.key);
                                    else next.add(channel.key);
                                    return next;
                                })
                            }
                        />
                        {channel.label} {channel.unit && `(${channel.unit})`}
                    </label>
                ))}
            </div>
            <ChartZoomSurface
                chartAreaRef={chartAreaRef}
                effectiveZoomRange={effectiveZoomRange}
                isChartDragging={isChartDragging}
                handleChartPointerDown={handleChartPointerDown}
                handleChartPointerMove={handleChartPointerMove}
                endChartDrag={endChartDrag}
                className="w-full"
                style={{ height }}
            >
                <div ref={elRef} className="h-full w-full" />
            </ChartZoomSurface>
        </div>
    );
};
