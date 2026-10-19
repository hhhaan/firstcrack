import { useRoastSettings } from '@features/active-roast';
import { CHART_GRID_LEFT } from '@features/active-roast/lib/chart-config';
import {
    type CompareChartSeries,
    compareChannels,
    compareChartRightMargin,
    compareChartXMax,
} from '@features/active-roast/lib/chart-option';
import { useChartZoom } from '@features/active-roast/model/useChartZoom';
import { ChartZoomSurface } from '@features/active-roast/ui/ChartZoomSurface';
import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ComparePhaseTimeline } from './ComparePhaseTimeline';
import { ComparePlot } from './ComparePlot';
import { CompareSessionReadouts } from './CompareSessionReadouts';
import type { CompareSessionItem } from './CompareSessionTable';

export type CompareSeries = CompareChartSeries;

interface CompareMultiChartProps {
    series: CompareSeries[];
    items: CompareSessionItem[];
    focusedSessionId: string | null;
    onToggle: (id: string) => void;
    onFocusSession: (id: string | null) => void;
}

export const CompareMultiChart = ({
    series,
    items,
    focusedSessionId,
    onToggle,
    onFocusSession,
}: CompareMultiChartProps) => {
    const { t } = useTranslation();
    const temperatureUnit = useRoastSettings().temperatureUnit;
    const [channelOverrides, setChannelOverrides] = useState<Record<string, boolean>>({});
    const [cursorSec, setCursorSec] = useState<number | null>(null);
    const active = useMemo(() => series.filter((s) => s.visible !== false && s.points.length > 0), [series]);
    const channels = useMemo(() => compareChannels(series, temperatureUnit), [series, temperatureUnit]);
    const selected = channels.filter((channel) => channelOverrides[channel.key] ?? channel.source !== 'extra');
    const mainChannels = selected.filter((channel) => channel.kind !== 'other');
    const otherChannels = selected.filter((channel) => channel.kind === 'other');
    const plottedKeys = useMemo(
        () => new Set(compareChannels(active, temperatureUnit).map((channel) => channel.key)),
        [active, temperatureUnit],
    );
    const rightMargin = compareChartRightMargin(mainChannels);
    // Keep the time axis fixed when batches are hidden so every plot and phase row stays aligned.
    const xMax = useMemo(() => compareChartXMax(series), [series]);
    const {
        setZoomRange,
        effectiveZoomRange,
        chartAreaRef,
        isChartDragging,
        handleChartPointerDown,
        handleChartPointerMove,
        endChartDrag,
    } = useChartZoom(xMax, 0, rightMargin);
    const xView = effectiveZoomRange ?? { start: 0, end: xMax };
    const cursorTime = Math.max(xView.start, Math.min(xView.end, cursorSec ?? Math.round(xMax / 2)));
    const cursorRatio = (cursorTime - xView.start) / (xView.end - xView.start);
    const plots = [
        ...(mainChannels.length
            ? [{ key: 'temperature', label: t('history.compare.tempAndRor'), channels: mainChannels, main: true }]
            : []),
        ...otherChannels.map((channel) => ({
            key: channel.key,
            label: `${channel.label} ${channel.unit}`,
            channels: [channel],
            main: false,
        })),
    ];

    return (
        <div className="flex flex-col min-[900px]:flex-row">
            <div className="min-w-0 flex-1 p-4">
                <fieldset className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
                    <legend className="sr-only">{t('history.compare.sensors')}</legend>
                    {channels.map((channel) => {
                        const checked = selected.some((entry) => entry.key === channel.key);
                        return (
                            <label
                                key={channel.key}
                                className="flex cursor-pointer items-center gap-1.5 text-xs text-primary"
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    aria-disabled={checked && selected.length === 1}
                                    onChange={() => {
                                        if (checked && selected.length === 1) return;
                                        setChannelOverrides((prev) => ({ ...prev, [channel.key]: !checked }));
                                    }}
                                    className="h-3.5 w-3.5 accent-primary"
                                />
                                <svg width="20" height="10" aria-hidden="true" className="text-secondary">
                                    <line x1="0" x2="20" y1="5" y2="5" stroke="currentColor" strokeWidth="2" />
                                </svg>
                                {channel.label}
                                <span className="text-secondary">{channel.unit}</span>
                            </label>
                        );
                    })}
                    {effectiveZoomRange && (
                        <button
                            type="button"
                            onClick={() => setZoomRange(null)}
                            className="ml-auto flex items-center gap-1 text-xs text-secondary underline underline-offset-2 hover:text-primary"
                        >
                            <RotateCcw size={11} />
                            {t('history.compare.resetZoom')}
                        </button>
                    )}
                </fieldset>
                <ChartZoomSurface
                    chartAreaRef={chartAreaRef}
                    effectiveZoomRange={effectiveZoomRange}
                    isChartDragging={isChartDragging}
                    handleChartPointerDown={handleChartPointerDown}
                    handleChartPointerMove={(event) => {
                        handleChartPointerMove(event);
                        const rect = event.currentTarget.getBoundingClientRect();
                        const x = event.clientX - rect.left - CHART_GRID_LEFT;
                        const width = rect.width - CHART_GRID_LEFT - rightMargin;
                        if (x >= 0 && x <= width)
                            setCursorSec(Math.round(xView.start + (x / width) * (xView.end - xView.start)));
                    }}
                    endChartDrag={endChartDrag}
                    className="relative w-full"
                    ariaLabel={t('history.compare.curveOverlay')}
                >
                    {plots.map((plot) => (
                        <div key={plot.key}>
                            <h3 className="pl-1 text-base font-semibold text-primary">{plot.label}</h3>
                            <div className="relative">
                                <ComparePlot
                                    series={active}
                                    channelKeys={plot.channels.map((channel) => channel.key)}
                                    xView={xView}
                                    temperatureUnit={temperatureUnit}
                                    focusedSessionId={focusedSessionId}
                                    rightMargin={rightMargin}
                                    label={plot.label}
                                    className={plot.main ? 'h-[clamp(300px,36vh,420px)] w-full' : 'h-40 w-full'}
                                />
                                {!plot.channels.some((channel) => plottedKeys.has(channel.key)) && (
                                    <div
                                        role="status"
                                        className="pointer-events-none absolute inset-0 flex items-center justify-center bg-main-bg/90 p-6 text-center text-sm text-secondary"
                                    >
                                        {t('history.compare.noSelectedSensorData')}
                                    </div>
                                )}
                            </div>
                            {plot.main && (
                                <ComparePhaseTimeline items={items} xView={xView} rightMargin={rightMargin} />
                            )}
                        </div>
                    ))}
                    <div
                        aria-hidden="true"
                        data-testid="compare-shared-cursor"
                        className="pointer-events-none absolute inset-y-6 z-10 border-l border-solid border-secondary"
                        style={{
                            left: `calc(${cursorRatio * 100}% + ${CHART_GRID_LEFT * (1 - cursorRatio) - rightMargin * cursorRatio}px)`,
                        }}
                    />
                </ChartZoomSurface>
            </div>
            <CompareSessionReadouts
                items={items}
                series={series}
                channels={selected}
                temperatureUnit={temperatureUnit}
                cursorTime={cursorTime}
                xView={xView}
                onCursorChange={setCursorSec}
                onToggle={onToggle}
                onFocusSession={onFocusSession}
            />
        </div>
    );
};
