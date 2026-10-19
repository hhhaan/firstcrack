import { useRoastSettings } from '@features/active-roast';
import {
    buildCompareChartOption,
    type CompareChartSeries,
    compareChannels,
    compareChartRightMargin,
    compareChartXMax,
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
    focusedSessionId: string | null;
}

export const CompareMultiChart = ({ series, showRoR = true, focusedSessionId }: CompareMultiChartProps) => {
    const { t } = useTranslation();
    const elRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const renderedFingerprintRef = useRef<string | null>(null);
    const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
    const temperatureUnit = useRoastSettings().temperatureUnit;
    const [selectedChannelKey, setSelectedChannelKey] = useState('bt');
    const active = useMemo(() => series.filter((s) => s.visible !== false && s.points.length > 0), [series]);
    const channels = useMemo(
        () => compareChannels(series, temperatureUnit).filter((channel) => showRoR || channel.kind !== 'ror'),
        [series, temperatureUnit, showRoR],
    );
    const defaultChannel = channels.length > 0 ? channels[0] : undefined;
    const selectedChannel = channels.find((channel) => channel.key === selectedChannelKey) ?? defaultChannel;
    const channelKeys = useMemo(() => (selectedChannel ? [selectedChannel.key] : []), [selectedChannel]);
    const plottedChannels = useMemo(
        () => compareChannels(active, temperatureUnit).filter((channel) => channelKeys.includes(channel.key)),
        [active, temperatureUnit, channelKeys],
    );
    const rightMargin = compareChartRightMargin(plottedChannels);

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
            `${dataFingerprint}|channels:${JSON.stringify(channelKeys)}|focus:${focusedSessionId}|ror:${showRoR}|${resolvedTheme}|unit:${temperatureUnit}|zoom:${effectiveZoomRange?.start ?? ''}:${effectiveZoomRange?.end ?? ''}`,
        [dataFingerprint, channelKeys, focusedSessionId, showRoR, resolvedTheme, temperatureUnit, effectiveZoomRange],
    );

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;
        const chart = echarts.init(el, undefined, { renderer: 'canvas', useDirtyRect: false });
        chartRef.current = chart;
        renderedFingerprintRef.current = null;

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

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || renderedFingerprintRef.current === fingerprint) return;
        const xView =
            effectiveZoomRange && effectiveZoomRange.start < effectiveZoomRange.end
                ? effectiveZoomRange
                : { start: 0, end: xMax };
        chart.setOption(
            buildCompareChartOption(active, showRoR, xView, temperatureUnit, channelKeys, focusedSessionId),
            {
                notMerge: true,
            },
        );
        renderedFingerprintRef.current = fingerprint;
    }, [active, channelKeys, effectiveZoomRange, fingerprint, focusedSessionId, showRoR, temperatureUnit, xMax]);

    return (
        <div className="flex flex-col min-[900px]:flex-row">
            <div className="min-w-0 flex-1 p-3">
                <div className="flex h-6 items-center justify-between px-2">
                    <span className="text-sm font-semibold text-primary">
                        {selectedChannel?.label}
                        <span className="ml-2 text-xs font-normal text-secondary">{selectedChannel?.unit}</span>
                    </span>
                    {effectiveZoomRange && (
                        <button
                            type="button"
                            onClick={() => setZoomRange(null)}
                            className="flex items-center gap-1 text-xs text-secondary underline underline-offset-2 hover:text-primary"
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
                    className="relative h-[clamp(280px,32vh,380px)] w-full"
                    ariaLabel={`${selectedChannel?.label ?? ''} ${selectedChannel?.unit ?? ''}`.trim()}
                >
                    <div ref={elRef} className="h-full w-full" />
                    {plottedChannels.length === 0 && (
                        <div
                            role="status"
                            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-main-bg/90 p-6 text-center text-sm text-secondary"
                        >
                            {t('history.compare.noSelectedSensorData')}
                        </div>
                    )}
                </ChartZoomSurface>
            </div>
            <aside
                className="shrink-0 overflow-y-auto border-t border-border bg-surface/25 p-4 min-[900px]:max-h-[calc(clamp(280px,32vh,380px)+48px)] min-[900px]:w-56 min-[900px]:border-t-0 min-[900px]:border-l"
                aria-label={t('history.compare.sensors')}
            >
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
                    <SlidersHorizontal size={13} strokeWidth={1.5} />
                    {t('history.compare.sensors')}
                    <span className="ml-auto font-mono text-xs text-secondary">{channels.length}</span>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3 min-[900px]:flex-col">
                    {[
                        { kind: 'temperature', label: t('history.compare.temperatures') },
                        { kind: 'ror', label: 'RoR' },
                        { kind: 'other', label: t('profiles.detail.extraSensors') },
                    ].map((group) => {
                        const groupChannels = channels.filter((channel) => channel.kind === group.kind);
                        if (groupChannels.length === 0) return null;
                        return (
                            <fieldset key={group.kind} className="min-w-36 min-[900px]:min-w-0">
                                <legend className="mb-1.5 text-xs font-medium text-secondary">{group.label}</legend>
                                <div className="space-y-1">
                                    {groupChannels.map((channel) => (
                                        <label
                                            key={channel.key}
                                            className={`relative flex cursor-pointer items-center gap-2 rounded-md border px-2 py-2 transition-colors ${channel.key === selectedChannel?.key ? 'border-border bg-main-bg' : 'border-transparent hover:bg-surface'}`}
                                        >
                                            <input
                                                type="radio"
                                                name="history-compare-sensor"
                                                className="peer sr-only"
                                                checked={channel.key === selectedChannel?.key}
                                                onChange={() => setSelectedChannelKey(channel.key)}
                                            />
                                            <span
                                                aria-hidden="true"
                                                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-main-bg text-transparent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-main-bg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
                                            >
                                                <Check size={10} strokeWidth={2.5} />
                                            </span>
                                            <span className="min-w-0 flex-1 text-[13px] text-secondary peer-checked:font-medium peer-checked:text-primary">
                                                <span className="block break-words">{channel.label}</span>
                                            </span>
                                            <span className="shrink-0 text-[11px] text-secondary">{channel.unit}</span>
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
