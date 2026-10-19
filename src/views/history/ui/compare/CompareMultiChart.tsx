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
import { Check, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type CompareSeries = CompareChartSeries;

interface CompareMultiChartProps {
    series: CompareSeries[];
    showRoR?: boolean;
}

const CHANNEL_DASH = { bt: '', et: '6 4', ror: '2 3', rorEt: '5 2 1 2', extra: '10 3 2 3' };

export const CompareMultiChart = ({ series, showRoR = true }: CompareMultiChartProps) => {
    const { t } = useTranslation();
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
        <div className="flex flex-col min-[900px]:flex-row">
            <div className="min-w-0 flex-1 p-3">
                <div className="flex h-6 items-center justify-between px-2">
                    <span className="text-[10px] text-muted">{t('history.compare.tempAndRor')}</span>
                    {effectiveZoomRange && (
                        <button
                            type="button"
                            onClick={() => setZoomRange(null)}
                            className="flex items-center gap-1 text-[11px] text-secondary underline underline-offset-2 hover:text-primary"
                        >
                            <RotateCcw size={11} />
                            {t('history.compare.resetZoom')}
                        </button>
                    )}
                </div>
                <ChartZoomSurface
                    chartAreaRef={chartAreaRef}
                    effectiveZoomRange={effectiveZoomRange}
                    isChartDragging={isChartDragging}
                    handleChartPointerDown={handleChartPointerDown}
                    handleChartPointerMove={handleChartPointerMove}
                    endChartDrag={endChartDrag}
                    className="h-[clamp(260px,32vh,380px)] w-full"
                    ariaLabel={t('history.compare.tempAndRor')}
                >
                    <div ref={elRef} className="h-full w-full" />
                </ChartZoomSurface>
            </div>
            <aside
                className="shrink-0 overflow-y-auto border-t border-border bg-surface/25 p-4 min-[900px]:max-h-[calc(clamp(260px,32vh,380px)+48px)] min-[900px]:w-52 min-[900px]:border-t-0 min-[900px]:border-l"
                aria-label={t('history.compare.sensors')}
            >
                <div className="mb-4 flex items-center gap-2 text-[11px] font-medium text-secondary">
                    <SlidersHorizontal size={13} strokeWidth={1.5} />
                    {t('history.compare.sensors')}
                    <span className="ml-auto font-mono text-[10px] text-muted">
                        {channelKeys.length}/{channels.length}
                    </span>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-4 min-[900px]:flex-col">
                    {[
                        { kind: 'temperature', label: t('history.compare.temperatures') },
                        { kind: 'ror', label: 'RoR' },
                        { kind: 'other', label: t('profiles.detail.extraSensors') },
                    ].map((group) => {
                        const groupChannels = channels.filter((channel) => channel.kind === group.kind);
                        if (groupChannels.length === 0) return null;
                        return (
                            <fieldset key={group.kind} className="min-w-36 min-[900px]:min-w-0">
                                <legend className="mb-1.5 text-[10px] text-muted">{group.label}</legend>
                                <div className="space-y-1">
                                    {groupChannels.map((channel) => (
                                        <label
                                            key={channel.key}
                                            className="group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-surface"
                                        >
                                            <input
                                                type="checkbox"
                                                className="peer sr-only"
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
                                            <span
                                                aria-hidden="true"
                                                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-border bg-main-bg text-transparent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-main-bg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
                                            >
                                                <Check size={10} strokeWidth={2.5} />
                                            </span>
                                            <svg
                                                width="22"
                                                height="10"
                                                className="shrink-0 text-muted peer-checked:text-secondary"
                                                aria-hidden="true"
                                            >
                                                <line
                                                    x1="0"
                                                    x2="22"
                                                    y1="5"
                                                    y2="5"
                                                    stroke="currentColor"
                                                    strokeWidth="1.5"
                                                    strokeDasharray={CHANNEL_DASH[channel.source]}
                                                />
                                            </svg>
                                            <span className="min-w-0 flex-1 text-[11px] text-muted peer-checked:text-primary">
                                                <span className="block break-words">{channel.label}</span>
                                                {channel.source === 'extra' && (
                                                    <span className="block text-[9px] text-muted">{channel.unit}</span>
                                                )}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                        );
                    })}
                </div>
            </aside>
        </div>
    );
};
