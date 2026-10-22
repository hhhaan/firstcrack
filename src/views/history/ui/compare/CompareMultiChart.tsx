import { useRoastSettings } from '@features/active-roast';
import { CHART_GRID_LEFT } from '@features/active-roast/lib/chart-config';
import {
    COMPARE_GRID_LEFT,
    type CompareChartSeries,
    compareChannels,
    compareChartRightMargin,
    compareChartXMax,
} from '@features/active-roast/lib/chart-option';
import { useChartZoom } from '@features/active-roast/model/useChartZoom';
import { ChartZoomSurface } from '@features/active-roast/ui/ChartZoomSurface';
import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ComparePlot } from './ComparePlot';

export type CompareSeries = CompareChartSeries;

interface CompareMultiChartProps {
    series: CompareSeries[];
    channelKeys: string[];
    focusedSessionId: string | null;
    cursorSec: number | null;
    onCursorSec: (sec: number | null) => void;
    label?: string;
    hintId?: string;
    plotClassName?: string;
    /** Match another compare plot's right inset so the time axes line up. */
    alignRightMargin?: number;
    /** Shared time window. When set, this plot does not zoom on its own. */
    xView?: { start: number; end: number };
    showEndLabels?: boolean;
    hideAxisName?: boolean;
}

export const CompareMultiChart = (props: CompareMultiChartProps) =>
    props.xView ? <CompareChartFrame {...props} xView={props.xView} /> : <ZoomCompareChart {...props} />;

const ZoomCompareChart = ({
    series,
    channelKeys,
    focusedSessionId,
    cursorSec,
    onCursorSec,
    label,
    hintId = 'compare-chart-keyboard-hint',
    plotClassName = 'h-[clamp(420px,54vh,640px)] w-full',
    alignRightMargin,
    showEndLabels = true,
}: CompareMultiChartProps) => {
    const { t } = useTranslation();
    const temperatureUnit = useRoastSettings().temperatureUnit;
    const active = useMemo(() => series.filter((s) => s.visible !== false && s.points.length > 0), [series]);
    const selected = useMemo(
        () => compareChannels(series, temperatureUnit).filter((channel) => channelKeys.includes(channel.key)),
        [series, temperatureUnit, channelKeys],
    );
    const plottedKeys = useMemo(
        () => new Set(compareChannels(active, temperatureUnit).map((channel) => channel.key)),
        [active, temperatureUnit],
    );
    const hasPlotted = selected.some((channel) => plottedKeys.has(channel.key));
    const rightMargin = alignRightMargin ?? compareChartRightMargin(selected);
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
    const chartLabel = label ?? t('history.compare.curveOverlay');

    return (
        <div>
            <div className="mb-2 flex justify-end">
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
            {selected.length > 0 && hasPlotted ? (
                <div role="region" aria-label={chartLabel} className="rounded">
                    <div
                        role="slider"
                        aria-label={chartLabel}
                        aria-describedby={hintId}
                        aria-valuemin={xView.start}
                        aria-valuemax={xView.end}
                        aria-valuenow={cursorTime ?? xView.start}
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
                            onCursorSec(Math.max(xView.start, Math.min(xView.end, next)));
                        }}
                        className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <p id={hintId} className="sr-only">
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
                                    onCursorSec(Math.round(xView.start + (x / width) * (xView.end - xView.start)));
                            }}
                            endChartDrag={endChartDrag}
                            className="relative w-full"
                        >
                            <ComparePlot
                                series={active}
                                channelKeys={channelKeys}
                                xView={xView}
                                temperatureUnit={temperatureUnit}
                                focusedSessionId={focusedSessionId}
                                rightMargin={rightMargin}
                                className={plotClassName}
                                showEndLabels={showEndLabels}
                            />
                        </ChartZoomSurface>
                    </div>
                </div>
            ) : (
                <div
                    role="status"
                    className="flex h-80 items-center justify-center p-6 text-center text-sm text-secondary"
                >
                    {t('history.compare.noSelectedSensorData')}
                </div>
            )}
        </div>
    );
};

const CompareChartFrame = ({
    series,
    channelKeys,
    focusedSessionId,
    onCursorSec,
    label,
    plotClassName = 'h-48 w-full',
    alignRightMargin = 56,
    xView,
    showEndLabels = false,
    hideAxisName = false,
}: CompareMultiChartProps & { xView: { start: number; end: number } }) => {
    const { t } = useTranslation();
    const temperatureUnit = useRoastSettings().temperatureUnit;
    const active = useMemo(() => series.filter((item) => item.visible !== false && item.points.length > 0), [series]);
    const chartLabel = label ?? t('history.compare.curveOverlay');
    const view = xView;

    return (
        <div
            role="region"
            aria-label={chartLabel}
            className="w-full min-w-0"
            onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const x = event.clientX - rect.left - COMPARE_GRID_LEFT;
                const width = rect.width - COMPARE_GRID_LEFT - alignRightMargin;
                if (width > 0 && x >= 0 && x <= width)
                    onCursorSec(Math.round(view.start + (x / width) * (view.end - view.start)));
            }}
        >
            <ComparePlot
                series={active}
                channelKeys={channelKeys}
                xView={view}
                temperatureUnit={temperatureUnit}
                focusedSessionId={focusedSessionId}
                rightMargin={alignRightMargin}
                className={plotClassName}
                showEndLabels={showEndLabels}
                hideAxisName={hideAxisName}
            />
        </div>
    );
};
