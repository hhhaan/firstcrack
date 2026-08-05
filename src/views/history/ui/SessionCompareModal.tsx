import { sessionBeanName, useHistoryCharts } from '@entities/roast';
import { computePhaseSegments } from '@features/active-roast';
import { parseStoredRoastEvents, storedEventsToLogEntries } from '@features/active-roast/lib/serialize-roast-events';
import { formatDateShort, formatDuration } from '@shared/lib/format';
import { deriveSessionDevMetrics } from '@shared/lib/roast-delta';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { COMPARE_COLORS } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CompareMultiChart, type CompareSeries } from './compare/CompareMultiChart';
import { ComparePhaseBars, type PhaseBarRow } from './compare/ComparePhaseBars';
import { CompareSessionSidebar, type CompareSidebarItem } from './compare/CompareSessionSidebar';

interface SessionCompareModalProps {
    sessions: RoastSessionWithRelations[];
    onClose: () => void;
}

export const SessionCompareModal = ({ sessions, onClose }: SessionCompareModalProps): ReactNode => {
    const { t } = useTranslation();
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

    const curveQueries = useHistoryCharts(
        sessions.map((s) => s.tsv_path ?? null),
        sessions.map((s) => s.id),
    );

    const isLoading = curveQueries.some((q) => q.isLoading);

    const eventsBySession = useMemo(() => sessions.map((s) => parseStoredRoastEvents(s.events)), [sessions]);

    const items: CompareSidebarItem[] = useMemo(
        () =>
            sessions.map((s, i) => {
                const points = curveQueries[i]?.data ?? [];
                const first = points[0];
                const last = points[points.length - 1];
                const events = eventsBySession[i];
                const dropEvt = events.find((e) => e.type === 'Drop');
                const chargeEvt = events.find((e) => e.type === 'Charge');
                return {
                    session: s,
                    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                    hasCurve: points.length > 0,
                    events,
                    chargeBt: chargeEvt?.temp_c ?? first?.bt ?? null,
                    dropBt: dropEvt?.temp_c ?? s.drop_temp_celsius ?? last?.bt ?? null,
                    chargeEt: first?.et ?? null,
                    dropEt: last?.et ?? null,
                    visible: !hiddenIds.has(s.id),
                };
            }),
        [sessions, curveQueries, eventsBySession, hiddenIds],
    );

    const chartSeries: CompareSeries[] = useMemo(
        () =>
            sessions.map((s, i) => {
                const points = curveQueries[i]?.data ?? [];
                return {
                    id: s.id,
                    label: sessionBeanName(s) ?? formatDateShort(s.roasted_at),
                    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                    points,
                    markers: eventsBySession[i]
                        .filter((e) => e.type !== 'Charge' && e.type !== 'End')
                        .map((e) => ({ timeSec: e.time_sec, event: e.type })),
                    visible: !hiddenIds.has(s.id),
                };
            }),
        [sessions, curveQueries, eventsBySession, hiddenIds],
    );

    const phaseRows: PhaseBarRow[] = useMemo(
        () =>
            sessions.map((s, i) => {
                const events = eventsBySession[i];
                const logs = storedEventsToLogEntries(events);
                const totalSec =
                    s.duration_seconds ??
                    events.find((e) => e.type === 'Drop')?.time_sec ??
                    events.find((e) => e.type === 'End')?.time_sec ??
                    0;
                return {
                    id: s.id,
                    color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                    label: sessionBeanName(s) ?? '—',
                    segments: computePhaseSegments(logs, totalSec, totalSec > 0),
                    totalSec,
                    visible: !hiddenIds.has(s.id),
                };
            }),
        [sessions, eventsBySession, hiddenIds],
    );

    const maxPhaseSec = Math.max(1, ...phaseRows.map((r) => r.totalSec));
    const hasAnyCurve = chartSeries.some((s) => s.points.length > 0);
    const hasAnyPhase = phaseRows.some((r) => r.segments.length > 0);

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
        <ModalShell onClose={onClose} labelledBy="session-compare-title" contentClassName={modalPanel.compare}>
            <div className="flex items-center justify-between border-b border-black/5 px-6 py-4 dark:border-[#585d61]">
                <h2 id="session-compare-title" className="text-[15px] font-medium tracking-[0.14px] text-primary">
                    {t('history.compare.title', { count: sessions.length })}
                </h2>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('history.compare.close')}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-primary"
                >
                    <X size={16} strokeWidth={2} />
                </button>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* Main: charts + phases */}
                <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
                    <div className="mb-1 text-[12px] font-medium tracking-[0.14px] text-primary">
                        {t('history.compare.tempAndRor')}
                    </div>
                    {isLoading ? (
                        <div className="flex h-[320px] items-center justify-center text-xs text-muted">
                            {t('history.expanded.chartLoading')}
                        </div>
                    ) : hasAnyCurve ? (
                        <CompareMultiChart series={chartSeries} height={320} showRoR />
                    ) : (
                        <div className="flex h-[200px] items-center justify-center text-xs text-muted">
                            {t('history.compare.noCurves')}
                        </div>
                    )}

                    {hasAnyPhase && (
                        <div className="mt-5">
                            <div className="mb-2 text-[12px] font-medium tracking-[0.14px] text-primary">
                                {t('history.compare.phases')}
                            </div>
                            <ComparePhaseBars rows={phaseRows} maxSec={maxPhaseSec} />
                            <div className="mt-1.5 flex gap-3 pl-4.5 text-[10px] text-muted">
                                <span className="flex items-center gap-1">
                                    <span
                                        className="inline-block h-2 w-2 rounded-sm"
                                        style={{
                                            background:
                                                'color-mix(in srgb, var(--color-phase-drying) 45%, transparent)',
                                        }}
                                    />
                                    {t('history.compare.phaseDrying')}
                                </span>
                                <span className="flex items-center gap-1">
                                    <span
                                        className="inline-block h-2 w-2 rounded-sm"
                                        style={{
                                            background:
                                                'color-mix(in srgb, var(--color-phase-maillard) 45%, transparent)',
                                        }}
                                    />
                                    {t('history.compare.phaseMaillard')}
                                </span>
                                <span className="flex items-center gap-1">
                                    <span
                                        className="inline-block h-2 w-2 rounded-sm"
                                        style={{
                                            background:
                                                'color-mix(in srgb, var(--color-phase-development) 45%, transparent)',
                                        }}
                                    />
                                    {t('history.compare.phaseDevelopment')}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Compact metrics strip */}
                    <div className="mt-6 overflow-x-auto rounded-lg border border-black/5 dark:border-[#585d61]">
                        <table className="w-full min-w-[480px] border-collapse text-left">
                            <thead>
                                <tr className="border-b border-black/5 dark:border-[#585d61]">
                                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.4px] text-muted" />
                                    {items.map((item) => (
                                        <th key={item.session.id} className="px-3 py-2">
                                            <div className="flex items-center gap-1.5">
                                                <span
                                                    className="h-2 w-2 shrink-0 rounded-full"
                                                    style={{ backgroundColor: item.color }}
                                                />
                                                <span className="truncate text-[11px] font-semibold text-primary">
                                                    {sessionBeanName(item.session) ?? '—'}
                                                </span>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {(
                                    [
                                        {
                                            key: 'date',
                                            label: t('history.compare.date'),
                                            get: (it: CompareSidebarItem) => formatDateShort(it.session.roasted_at),
                                        },
                                        {
                                            key: 'profile',
                                            label: t('history.compare.profile'),
                                            get: (it: CompareSidebarItem) => it.session.roast_profiles?.name ?? '—',
                                        },
                                        {
                                            key: 'duration',
                                            label: t('history.compare.duration'),
                                            get: (it: CompareSidebarItem) =>
                                                formatDuration(it.session.duration_seconds),
                                        },
                                        {
                                            key: 'drop',
                                            label: t('history.compare.dropTemp'),
                                            get: (it: CompareSidebarItem) =>
                                                it.dropBt != null ? `${it.dropBt.toFixed(1)}°C` : '—',
                                        },
                                        {
                                            key: 'dtr',
                                            label: t('history.compare.dtr'),
                                            get: (it: CompareSidebarItem) => {
                                                const d = deriveSessionDevMetrics(
                                                    it.events,
                                                    it.session.duration_seconds,
                                                );
                                                return d.devPct != null ? `${d.devPct.toFixed(1)}%` : '—';
                                            },
                                        },
                                        ...(items.some((it) => {
                                            const d = deriveSessionDevMetrics(it.events, it.session.duration_seconds);
                                            return d.rollingDevPct != null;
                                        })
                                            ? [
                                                  {
                                                      key: 'dtrRolling',
                                                      label: t('history.compare.dtrRolling'),
                                                      get: (it: CompareSidebarItem) => {
                                                          const d = deriveSessionDevMetrics(
                                                              it.events,
                                                              it.session.duration_seconds,
                                                          );
                                                          return d.rollingDevPct != null
                                                              ? `${d.rollingDevPct.toFixed(1)}%`
                                                              : '—';
                                                      },
                                                  },
                                              ]
                                            : []),
                                        {
                                            key: 'level',
                                            label: t('history.compare.level'),
                                            get: (it: CompareSidebarItem) => it.session.roast_level ?? '—',
                                        },
                                    ] as {
                                        key: string;
                                        label: string;
                                        get: (it: CompareSidebarItem) => string;
                                    }[]
                                ).map((row) => (
                                    <tr
                                        key={row.key}
                                        className="border-b border-black/5 last:border-b-0 dark:border-[#585d61]"
                                    >
                                        <td className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.4px] text-muted">
                                            {row.label}
                                        </td>
                                        {items.map((it) => (
                                            <td
                                                key={`${it.session.id}-${row.key}`}
                                                className="px-3 py-2 font-mono text-[12px] font-semibold tabular-nums tracking-[-0.2px] text-primary"
                                            >
                                                {row.get(it)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Right sidebar */}
                <aside className="w-[240px] shrink-0 border-l border-black/5 bg-[rgba(248,246,244,0.55)] px-3 py-4 dark:border-[#585d61] dark:bg-[rgba(24,29,33,0.65)]">
                    <CompareSessionSidebar items={items} onToggle={onToggle} />
                </aside>
            </div>
        </ModalShell>
    );
};
