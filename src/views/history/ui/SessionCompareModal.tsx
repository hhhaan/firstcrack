import { sessionBeanName, useHistoryCharts } from '@entities/roast';
import { summarizeSessionEvents } from '@entities/roast-profile';
import { computePhaseSegments, useRoastSettings } from '@features/active-roast';
import { parseStoredRoastEvents, storedEventsToLogEntries } from '@features/active-roast/lib/serialize-roast-events';
import { withEditedHeaterLog } from '@features/machine-control/lib/heater-events';
import { COMPARE_COLORS, COMPARE_LINE_DASHES } from '@shared/lib/compare-style';
import { formatDateShort } from '@shared/lib/format';
import { deriveRoastMetrics } from '@shared/lib/roast-delta';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { ChartNoAxesCombined, LoaderCircle, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CompareMultiChart, type CompareSeries } from './compare/CompareMultiChart';
import { CompareSessionLegend } from './compare/CompareSessionLegend';
import { type CompareSessionItem, CompareSessionTable } from './compare/CompareSessionTable';

interface SessionCompareModalProps {
    sessions: RoastSessionWithRelations[];
    onClose: () => void;
}

export const SessionCompareModal = ({ sessions, onClose }: SessionCompareModalProps): ReactNode => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
    const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);

    const curveQueries = useHistoryCharts(
        sessions.map((s) => s.tsv_path ?? null),
        sessions.map((s) => s.id),
    );

    const isLoading = curveQueries.some((q) => q.isLoading);

    // Compare draws Heater marks by time only, so the note unit is irrelevant here.
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
                    // event temps stay unrounded for compare; curve 00:00 is Charge when no mark/BBP
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
                return {
                    id: s.id,
                    label: `${String(i + 1).padStart(2, '0')} · ${sessionBeanName(s) ?? formatDateShort(s.roasted_at)}`,
                    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                    points,
                    lineDash: COMPARE_LINE_DASHES[i % COMPARE_LINE_DASHES.length],
                    markers: eventsBySession[i]
                        .filter((e) => e.type !== 'Charge' && e.type !== 'End')
                        .map((e) => ({ timeSec: e.time_sec, event: e.type })),
                    visible: !hiddenIds.has(s.id),
                };
            }),
        [sessions, curveQueries, eventsBySession, hiddenIds],
    );

    const hasAnyCurve = chartSeries.some((s) => s.points.length > 0);

    const onToggle = (id: string) => {
        setHiddenIds((prev) => {
            const next = new Set(prev);
            // keep at least one visible
            if (!next.has(id) && sessions.filter((s) => !next.has(s.id)).length <= 1) return prev;
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <ModalShell onClose={onClose} labelledBy="session-compare-title" contentClassName={modalPanel.compareWorkspace}>
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
                <div>
                    <h2 id="session-compare-title" className="text-xl font-medium tracking-[-0.4px] text-primary">
                        {t('history.compare.title', { count: sessions.length })}
                    </h2>
                    <p className="mt-1 text-[13px] text-secondary">{t('history.compare.workspaceHint')}</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('history.compare.close')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    <X size={18} strokeWidth={1.5} />
                </button>
            </header>
            <div className="min-h-0 space-y-6 overflow-y-auto p-6">
                <section
                    aria-labelledby="compare-curves-title"
                    className="overflow-hidden rounded-xl border border-border"
                >
                    <div className="space-y-3 border-b border-border px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 id="compare-curves-title" className="text-sm font-semibold text-primary">
                                {t('history.compare.curveOverlay')}
                            </h3>
                            <span className="text-xs text-secondary">{t('history.compare.chartHint')}</span>
                        </div>
                        <CompareSessionLegend items={items} onToggle={onToggle} onFocusSession={setFocusedSessionId} />
                    </div>
                    {isLoading ? (
                        <div role="status" className="flex h-80 items-center justify-center gap-2 text-xs text-muted">
                            <LoaderCircle size={16} className="motion-safe:animate-spin" />
                            {t('history.expanded.chartLoading')}
                        </div>
                    ) : hasAnyCurve ? (
                        <CompareMultiChart series={chartSeries} focusedSessionId={focusedSessionId} />
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
                <CompareSessionTable items={items} />
            </div>
        </ModalShell>
    );
};
