import { useRoastSettings } from '@features/active-roast';
import { CHART_GRID_LEFT } from '@features/active-roast/lib/chart-config';
import {
    type CompareChartSeries,
    compareChannels,
    compareChartRightMargin,
    compareChartXMax,
} from '@features/active-roast/lib/chart-option';
import { compareCurveStyle } from '@features/active-roast/lib/chart-option/compare-channels';
import { useChartZoom } from '@features/active-roast/model/useChartZoom';
import { useCurveStyles } from '@features/active-roast/model/useCurveStyles';
import { ChartZoomSurface } from '@features/active-roast/ui/ChartZoomSurface';
import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    const curves = useCurveStyles();
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [cursorSec, setCursorSec] = useState<number | null>(null);
    const active = useMemo(() => series.filter((s) => s.visible !== false && s.points.length > 0), [series]);
    const channels = useMemo(() => compareChannels(series, temperatureUnit), [series, temperatureUnit]);
    const selected =
        channels.find((channel) => channel.key === selectedKey) ?? (channels.length > 0 ? channels[0] : undefined);
    const selectedIndex = selected ? channels.indexOf(selected) : -1;
    const plottedKeys = useMemo(
        () => new Set(compareChannels(active, temperatureUnit).map((channel) => channel.key)),
        [active, temperatureUnit],
    );
    const rightMargin = compareChartRightMargin(selected ? [selected] : []);
    // Hiding a batch must not shift the shared time axis or phase rows.
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
    const cursorTime = cursorSec === null ? null : Math.max(xView.start, Math.min(xView.end, cursorSec));

    return (
        <div>
            <div className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                    <div role="tablist" aria-label={t('history.compare.sensors')} className="flex flex-wrap gap-1">
                        {channels.map((channel, index) => (
                            <button
                                key={channel.key}
                                id={`compare-channel-${index}`}
                                type="button"
                                role="tab"
                                aria-selected={selected === channel}
                                aria-controls="compare-channel-panel"
                                tabIndex={selected === channel ? 0 : -1}
                                onClick={() => setSelectedKey(channel.key)}
                                onKeyDown={(event) => {
                                    const next = new Map([
                                        ['ArrowRight', (index + 1) % channels.length],
                                        ['ArrowLeft', (index + channels.length - 1) % channels.length],
                                        ['Home', 0],
                                        ['End', channels.length - 1],
                                    ]).get(event.key);
                                    if (next === undefined) return;
                                    event.preventDefault();
                                    setSelectedKey(channels[next].key);
                                    event.currentTarget.parentElement
                                        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                                        [next]?.focus();
                                }}
                                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                                    selected === channel
                                        ? 'border-border bg-surface text-primary'
                                        : 'border-transparent text-secondary hover:bg-surface'
                                }`}
                            >
                                <span
                                    aria-hidden="true"
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: compareCurveStyle(channel, curves).color }}
                                />
                                {channel.label}
                                <span className="font-normal text-secondary">{channel.unit}</span>
                            </button>
                        ))}
                    </div>
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
                {selected ? (
                    <div
                        id="compare-channel-panel"
                        role="tabpanel"
                        aria-labelledby={`compare-channel-${selectedIndex}`}
                        aria-describedby="compare-chart-keyboard-hint"
                        // biome-ignore lint/a11y/noNoninteractiveTabindex: The chart panel supports keyboard sample inspection.
                        tabIndex={0}
                        onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            const next = new Map([
                                ['ArrowRight', (cursorTime ?? xView.start) + 1],
                                ['ArrowLeft', (cursorTime ?? xView.start) - 1],
                                ['Home', xView.start],
                                ['End', xView.end],
                            ]).get(event.key);
                            if (next === undefined) return;
                            event.preventDefault();
                            setCursorSec(Math.max(xView.start, Math.min(xView.end, next)));
                        }}
                        className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <p id="compare-chart-keyboard-hint" className="sr-only">
                            {t('history.compare.chartKeyboardHint')}
                        </p>
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
                                if (width > 0 && x >= 0 && x <= width)
                                    setCursorSec(Math.round(xView.start + (x / width) * (xView.end - xView.start)));
                            }}
                            endChartDrag={endChartDrag}
                            className="relative w-full"
                            ariaLabel={t('history.compare.curveOverlay')}
                        >
                            <div className="relative">
                                <ComparePlot
                                    series={active}
                                    channelKeys={[selected.key]}
                                    xView={xView}
                                    temperatureUnit={temperatureUnit}
                                    focusedSessionId={focusedSessionId}
                                    rightMargin={rightMargin}
                                    label={`${selected.label} ${selected.unit}`}
                                    className="h-[clamp(240px,30vh,360px)] w-full"
                                />
                                {!plottedKeys.has(selected.key) && (
                                    <div
                                        role="status"
                                        className="pointer-events-none absolute inset-0 flex items-center justify-center bg-main-bg/90 p-6 text-center text-sm text-secondary"
                                    >
                                        {t('history.compare.noSelectedSensorData')}
                                    </div>
                                )}
                            </div>
                        </ChartZoomSurface>
                    </div>
                ) : (
                    <div role="status" className="p-6 text-center text-sm text-secondary">
                        {t('history.compare.noSelectedSensorData')}
                    </div>
                )}
            </div>
            <CompareSessionReadouts
                items={items}
                series={series}
                channels={channels}
                selectedKey={selected?.key ?? null}
                focusedSessionId={focusedSessionId}
                temperatureUnit={temperatureUnit}
                cursorTime={cursorTime}
                onToggle={onToggle}
                onFocusSession={onFocusSession}
            />
        </div>
    );
};
