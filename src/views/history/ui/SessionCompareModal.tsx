import { ROASTER_REGISTRY, useMachines } from '@entities/machine';
import { useHistoryCharts } from '@entities/roast';
import { summarizeSessionEvents } from '@entities/roast-profile';
import { computePhaseSegments, useRoastSettings } from '@features/active-roast';
import {
    COMPARE_GRID_LEFT,
    COMPARE_GRID_RIGHT,
    compareChannels,
    compareChartXMax,
    isCompareControlChannel,
} from '@features/active-roast/lib/chart-option';
import { parseStoredRoastEvents, storedEventsToLogEntries } from '@features/active-roast/lib/serialize-roast-events';
import { useChartZoom } from '@features/active-roast/model/useChartZoom';
import { ChartZoomSurface } from '@features/active-roast/ui/ChartZoomSurface';
import { editedHeatSet, profileHeaterBounds, withEditedHeaterLog } from '@features/machine-control/lib/heater-events';
import { COMPARE_COLORS } from '@shared/lib/compare-style';
import { formatDateShort } from '@shared/lib/format';
import { deriveRoastMetrics } from '@shared/lib/roast-delta';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { ChartNoAxesCombined, ChevronLeft, LoaderCircle, RotateCcw } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionDropTime } from '../lib/record-heat';
import { CompareMultiChart, type CompareSeries } from './compare/CompareMultiChart';
import { ComparePhaseBar } from './compare/ComparePhaseBar';
import { ComparePlot } from './compare/ComparePlot';
import { type CompareSessionItem, CompareSessionTable } from './compare/CompareSessionTable';
import { CompareSidePanel } from './compare/CompareSidePanel';

interface SessionCompareModalProps {
    sessions: RoastSessionWithRelations[];
    onClose: () => void;
}

const defaultChannelKeys = (keys: string[]): string[] => {
    const preferred = keys.filter((key) => key === 'bt' || key === 'ror');
    if (preferred.length > 0) return preferred;
    return keys.slice(0, 1);
};

export const SessionCompareModal = ({ sessions, onClose }: SessionCompareModalProps): ReactNode => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const machines = useMachines((s) => s.machines);
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
    const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
    const [cursorSec, setCursorSec] = useState<number | null>(null);
    const [channelPick, setChannelPick] = useState<string[] | null>(null);
    const [controlPick, setControlPick] = useState<string[] | null>(null);
    const [showModulation, setShowModulation] = useState(true);
    const [showStatistics, setShowStatistics] = useState(true);

    const curveQueries = useHistoryCharts(
        sessions.map((s) => s.tsv_path ?? null),
        sessions.map((s) => s.id),
    );

    const isLoading = curveQueries.some((q) => q.isLoading);

    const eventsBySession = useMemo(
        () => sessions.map((s) => withEditedHeaterLog(parseStoredRoastEvents(s.events), s.heater_events, '')),
        [sessions],
    );

    const items: CompareSessionItem[] = useMemo(
        () =>
            sessions.map((s, i) => {
                const points = curveQueries[i]?.data ?? [];
                const first = points.length ? points[0] : undefined;
                const last = points.length ? points[points.length - 1] : undefined;
                const events = eventsBySession[i];
                const summary = summarizeSessionEvents(events, s);
                const chargeEvt = events.find((e) => e.type === 'Charge');
                const dropEvt = events.find((e) => e.type === 'Drop');
                const metrics = deriveRoastMetrics(events, { durationFallback: s.duration_seconds });
                const duration = metrics.roastDurationSec ?? 0;
                return {
                    session: s,
                    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                    hasCurve: points.length > 0,
                    events,
                    metrics,
                    segments: computePhaseSegments(storedEventsToLogEntries(events, unit), duration, duration > 0),
                    chargeBt: chargeEvt?.temp_c ?? summary.charge_temp_celsius ?? first?.bt ?? null,
                    dropBt: dropEvt?.temp_c ?? summary.drop_temp_celsius ?? last?.bt ?? null,
                    dropEt: last?.et ?? null,
                    visible: !hiddenIds.has(s.id),
                };
            }),
        [sessions, curveQueries, eventsBySession, hiddenIds, unit],
    );

    const chartSeries: CompareSeries[] = useMemo(
        () =>
            sessions.map((s, i) => {
                const points = curveQueries[i]?.data ?? [];
                const heatSet = editedHeatSet(points, sessionDropTime(s), s.heater_events);
                const heaterUnit = profileHeaterBounds(s, machines, ROASTER_REGISTRY).unit;
                const profileBatch = s.profile_batch_number != null ? `#${s.profile_batch_number}` : null;
                const slot = String(i + 1).padStart(2, '0');
                return {
                    id: s.id,
                    label: `${profileBatch ?? slot} · ${sessionRoastTitle(s) ?? formatDateShort(s.roasted_at)}`,
                    batchIndex: i,
                    batchLabel: profileBatch ?? undefined,
                    points: points.map((point, index) => ({
                        ...point,
                        heaterSet: heatSet ? heatSet[index] : (point.heaterSet ?? null),
                        heaterUnit,
                        fanUnit: point.processing?.read_units?.fan,
                        drumUnit: point.processing?.read_units?.drum,
                    })),
                    markers: eventsBySession[i]
                        .filter((e) => e.type !== 'Charge' && e.type !== 'End')
                        .map((e) => ({ timeSec: e.time_sec, event: e.type })),
                    visible: !hiddenIds.has(s.id),
                };
            }),
        [sessions, curveQueries, eventsBySession, hiddenIds, machines],
    );

    const channels = useMemo(() => compareChannels(chartSeries, unit), [chartSeries, unit]);
    const sensorKeys = channels.filter((channel) => !isCompareControlChannel(channel)).map((channel) => channel.key);
    const controlKeys = channels.filter(isCompareControlChannel).map((channel) => channel.key);
    const enabledSensorKeys = channelPick ?? defaultChannelKeys(sensorKeys);
    const enabledControlKeys = controlPick ?? controlKeys;
    const enabledKeys = [...enabledSensorKeys, ...enabledControlKeys];
    const xMax = useMemo(() => compareChartXMax(chartSeries), [chartSeries]);
    const zoom = useChartZoom(xMax, 0, COMPARE_GRID_RIGHT);
    const xView = zoom.effectiveZoomRange ?? { start: 0, end: xMax };
    const controlCharts = channels.filter(
        (channel) => isCompareControlChannel(channel) && enabledControlKeys.includes(channel.key),
    );
    const visibleSensorHasData = compareChannels(
        chartSeries.filter((item) => item.visible !== false),
        unit,
    ).some((channel) => enabledSensorKeys.includes(channel.key) && !isCompareControlChannel(channel));
    const hasAnyCurve = chartSeries.some((s) => s.points.length > 0);
    const visibleItems = items.filter((item) => item.visible);

    const onToggle = (id: string) => {
        setHiddenIds((prev) => {
            const next = new Set(prev);
            if (!next.has(id) && sessions.filter((s) => !next.has(s.id)).length <= 1) return prev;
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const onToggleChannel = (key: string) => {
        if (controlKeys.includes(key)) {
            setControlPick((prev) => {
                const current = prev ?? controlKeys;
                return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
            });
            return;
        }
        setChannelPick((prev) => {
            const current = prev ?? defaultChannelKeys(sensorKeys);
            return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
        });
    };

    return (
        <article aria-labelledby="session-compare-title" data-testid="compare-report" className="min-w-0">
            <button
                type="button"
                onClick={onClose}
                className="mb-3 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] text-muted transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
                <ChevronLeft size={14} strokeWidth={2} />
                {t('history.title')}
            </button>
            <h2 id="session-compare-title" className="mb-3 text-lg font-medium tracking-[-0.4px] text-primary">
                {t('history.compare.title', { count: sessions.length })}
            </h2>
            <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_272px]">
                <div className="min-w-0 space-y-4">
                    <section className="rounded-xl border border-border bg-main-bg p-3">
                        {isLoading ? (
                            <div
                                role="status"
                                className="flex h-80 items-center justify-center gap-2 text-xs text-muted"
                            >
                                <LoaderCircle size={16} className="motion-safe:animate-spin" />
                                {t('history.expanded.chartLoading')}
                            </div>
                        ) : hasAnyCurve ? (
                            <>
                                {visibleSensorHasData ? (
                                    <>
                                        <div className="mb-1 flex justify-end">
                                            {zoom.effectiveZoomRange && (
                                                <button
                                                    type="button"
                                                    onClick={() => zoom.setZoomRange(null)}
                                                    className="flex items-center gap-1 text-xs text-secondary underline underline-offset-2 hover:text-primary"
                                                >
                                                    <RotateCcw size={11} />
                                                    {t('history.compare.resetZoom')}
                                                </button>
                                            )}
                                        </div>
                                        <div
                                            role="region"
                                            aria-label={t('history.compare.curveOverlay')}
                                            className="rounded"
                                        >
                                            <div
                                                role="slider"
                                                aria-label={t('history.compare.curveOverlay')}
                                                aria-describedby="compare-chart-keyboard-hint"
                                                aria-valuemin={xView.start}
                                                aria-valuemax={xView.end}
                                                aria-valuenow={cursorSec ?? xView.start}
                                                tabIndex={0}
                                                onKeyDown={(event) => {
                                                    if (event.target !== event.currentTarget) return;
                                                    const next = new Map([
                                                        ['ArrowRight', (cursorSec ?? xView.start) + 1],
                                                        ['ArrowLeft', (cursorSec ?? xView.start) - 1],
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
                                                    chartAreaRef={zoom.chartAreaRef}
                                                    effectiveZoomRange={zoom.effectiveZoomRange}
                                                    isChartDragging={zoom.isChartDragging}
                                                    handleChartPointerDown={zoom.handleChartPointerDown}
                                                    handleChartPointerMove={(event) => {
                                                        zoom.handleChartPointerMove(event);
                                                        const rect = event.currentTarget.getBoundingClientRect();
                                                        const x = event.clientX - rect.left - COMPARE_GRID_LEFT;
                                                        const width =
                                                            rect.width - COMPARE_GRID_LEFT - COMPARE_GRID_RIGHT;
                                                        if (width > 0 && x >= 0 && x <= width)
                                                            setCursorSec(
                                                                Math.round(
                                                                    xView.start +
                                                                        (x / width) * (xView.end - xView.start),
                                                                ),
                                                            );
                                                    }}
                                                    endChartDrag={zoom.endChartDrag}
                                                    className="relative w-full"
                                                >
                                                    <ComparePlot
                                                        series={chartSeries.filter((item) => item.visible !== false)}
                                                        channelKeys={enabledSensorKeys}
                                                        xView={xView}
                                                        temperatureUnit={unit}
                                                        focusedSessionId={focusedSessionId}
                                                        rightMargin={COMPARE_GRID_RIGHT}
                                                        className="h-[clamp(420px,54vh,640px)] w-full"
                                                    />
                                                </ChartZoomSurface>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div
                                        role="status"
                                        className="flex h-80 items-center justify-center p-6 text-center text-sm text-secondary"
                                    >
                                        {t('history.compare.noSelectedSensorData')}
                                    </div>
                                )}
                                {showModulation && (
                                    <div
                                        className="space-y-1"
                                        style={{ marginLeft: COMPARE_GRID_LEFT, marginRight: COMPARE_GRID_RIGHT }}
                                    >
                                        {visibleItems.map((item) => (
                                            <ComparePhaseBar
                                                key={item.session.id}
                                                segments={item.segments}
                                                totalSec={item.metrics.roastDurationSec ?? 0}
                                                window={xView}
                                            />
                                        ))}
                                    </div>
                                )}
                                {controlCharts.map((channel) => (
                                    <div key={channel.key}>
                                        <h3 className="mb-1 text-[13px] font-semibold text-primary">
                                            {channel.label} ({channel.unit})
                                        </h3>
                                        <CompareMultiChart
                                            series={chartSeries}
                                            channelKeys={[channel.key]}
                                            focusedSessionId={focusedSessionId}
                                            cursorSec={cursorSec}
                                            onCursorSec={setCursorSec}
                                            label={`${channel.label} (${channel.unit})`}
                                            hideAxisName
                                            xView={xView}
                                            alignRightMargin={COMPARE_GRID_RIGHT}
                                            plotClassName="h-48 w-full"
                                        />
                                    </div>
                                ))}
                            </>
                        ) : (
                            <div
                                role="status"
                                className="flex h-64 flex-col items-center justify-center gap-3 text-xs text-muted"
                            >
                                <ChartNoAxesCombined size={28} strokeWidth={1} />
                                {t('history.compare.noCurves')}
                            </div>
                        )}
                    </section>
                    {showStatistics && <CompareSessionTable items={items} />}
                </div>
                <CompareSidePanel
                    items={items}
                    channels={channels}
                    enabledKeys={enabledKeys}
                    onToggleChannel={onToggleChannel}
                    showModulation={showModulation}
                    onToggleModulation={() => setShowModulation((value) => !value)}
                    showStatistics={showStatistics}
                    onToggleStatistics={() => setShowStatistics((value) => !value)}
                    focusedSessionId={focusedSessionId}
                    onToggleRoast={onToggle}
                    onFocusSession={setFocusedSessionId}
                />
            </div>
        </article>
    );
};
