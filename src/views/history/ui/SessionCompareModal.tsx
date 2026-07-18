import { useHistoryCharts } from '@entities/roast';
import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatDateShort, formatDuration, formatElapsed } from '@shared/lib/format';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import type { SeriesData } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { COMPARE_COLORS, ProfileCurveChart } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { AlertCircle, X } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** 이벤트 정렬 표 행 순서 — 로스팅 진행 순 */
const EVENT_ORDER = ['Charge', 'TP', 'Yellow', 'FC Start', 'FC End', 'Drop', 'End'] as const;

const sessionLabel = (s: RoastSessionWithRelations): string =>
    `${s.beans?.name ?? '—'} · ${formatDateShort(s.roasted_at)}`;

const useMetaRows = (): { label: string; getValue: (s: RoastSessionWithRelations) => string }[] => {
    const { t } = useTranslation();
    return [
        { label: t('history.table.date'), getValue: (s) => formatDateShort(s.roasted_at) },
        { label: t('history.table.bean'), getValue: (s) => s.beans?.name ?? '—' },
        { label: t('history.table.profile'), getValue: (s) => s.roast_profiles?.name ?? '—' },
        { label: t('history.table.weight'), getValue: (s) => `${s.weight_grams}g` },
        {
            label: t('history.table.dropTemp'),
            getValue: (s) => (s.drop_temp_celsius != null ? `${s.drop_temp_celsius}°C` : '—'),
        },
        { label: t('history.table.duration'), getValue: (s) => formatDuration(s.duration_seconds) },
        { label: t('history.table.level'), getValue: (s) => s.roast_level ?? '—' },
    ];
};

interface SessionCompareModalProps {
    sessions: RoastSessionWithRelations[];
    onClose: () => void;
}

export const SessionCompareModal = ({ sessions, onClose }: SessionCompareModalProps): ReactNode => {
    const { t } = useTranslation();
    const metaRows = useMetaRows();
    const curveQueries = useHistoryCharts(
        sessions.map((s) => s.tsv_path ?? null),
        sessions.map((s) => s.id),
    );

    const isLoading = curveQueries.some((q) => q.isLoading);
    const chartSeries: SeriesData[] = sessions.flatMap((s, i) => {
        const points = curveQueries[i]?.data ?? [];
        if (points.length === 0) return [];
        return [
            {
                curve: points.map((p) => ({ t: p.t, bt: p.bt })),
                color: COMPARE_COLORS[i % COMPARE_COLORS.length],
                label: sessionLabel(s),
            },
        ];
    });
    const chartKey = sessions.map((s) => `${s.id}:${s.tsv_path ?? ''}`).join('|');

    const eventsBySession = useMemo(() => sessions.map((s) => parseStoredRoastEvents(s.events)), [sessions]);
    const eventRows = EVENT_ORDER.filter((type) => eventsBySession.some((evts) => evts.some((e) => e.type === type)));

    return (
        <ModalShell onClose={onClose} labelledBy="session-compare-title" contentClassName={modalPanel.formLg}>
            <div className="flex items-center justify-between px-8 pt-7 pb-4">
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

            <div className="overflow-y-auto px-8 pb-7">
                <div className="mb-3 rounded-lg bg-surface dark:bg-surface-elevated px-4 pt-4 pb-2">
                    <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.5px] text-muted">
                        {t('history.compare.curveOverlay')}
                    </div>
                    {isLoading ? (
                        <div className="flex h-[160px] items-center justify-center text-xs text-muted">
                            {t('history.expanded.chartLoading')}
                        </div>
                    ) : chartSeries.length > 0 ? (
                        <ProfileCurveChart key={chartKey} series={chartSeries} />
                    ) : (
                        <div className="flex h-[160px] items-center justify-center text-xs text-muted">
                            {t('history.compare.noCurves')}
                        </div>
                    )}
                </div>

                <div className="mb-5 flex flex-wrap gap-2">
                    {sessions.map((s, i) => {
                        const hasCurve = (curveQueries[i]?.data?.length ?? 0) > 0;
                        return (
                            <div
                                key={s.id}
                                className="flex items-center gap-1.5 rounded-full bg-surface dark:bg-surface-elevated px-2.5 py-1"
                            >
                                <div
                                    className="h-2 w-2 flex-shrink-0 rounded-full"
                                    style={{ backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                                />
                                <span className="text-[12px] font-medium tracking-[0.14px] text-secondary">
                                    {sessionLabel(s)}
                                </span>
                                {!hasCurve && !isLoading && (
                                    <span title={t('history.compare.noCurveData')} className="flex items-center">
                                        <AlertCircle size={10} strokeWidth={2} className="text-amber-500" />
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="overflow-hidden rounded-lg bg-surface dark:bg-surface-elevated">
                    <div className="grid" style={{ gridTemplateColumns: `110px repeat(${sessions.length}, 1fr)` }}>
                        <div className="border-b border-black/5 dark:border-[#585d61] px-3.5 py-2.5" />
                        {sessions.map((s, i) => (
                            <div
                                key={s.id}
                                className="border-b border-l border-black/5 border-l-black/5 dark:border-[#585d61] dark:border-l-[#585d61] px-3.5 py-2.5"
                            >
                                <div className="flex items-center gap-1.5">
                                    <div
                                        className="h-2 w-2 flex-shrink-0 rounded-full"
                                        style={{ backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                                    />
                                    <span className="truncate text-[11px] font-semibold tracking-[0.14px] text-primary">
                                        {s.beans?.name ?? '—'}
                                    </span>
                                </div>
                            </div>
                        ))}
                        {metaRows.flatMap(({ label, getValue }, rowIdx) => [
                            <div
                                key={`lbl-${label}`}
                                className={`px-3.5 py-2.5 ${rowIdx < metaRows.length - 1 ? 'border-b border-black/5 dark:border-[#585d61]' : ''}`}
                            >
                                <span className="text-[11px] font-medium uppercase tracking-[0.4px] text-muted">
                                    {label}
                                </span>
                            </div>,
                            ...sessions.map((s) => (
                                <div
                                    key={`${s.id}-${label}`}
                                    className={`border-l border-l-black/5 dark:border-l-[#585d61] px-3.5 py-2.5 ${rowIdx < metaRows.length - 1 ? 'border-b border-black/5 dark:border-[#585d61]' : ''}`}
                                >
                                    <span className="font-mono text-[12px] font-semibold tracking-[-0.2px] text-primary">
                                        {getValue(s)}
                                    </span>
                                </div>
                            )),
                        ])}
                    </div>
                </div>

                {eventRows.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-lg bg-surface dark:bg-surface-elevated">
                        <div className="px-3.5 pt-2.5 text-[11px] font-medium uppercase tracking-[0.4px] text-muted">
                            {t('history.compare.events')}
                        </div>
                        <div className="grid" style={{ gridTemplateColumns: `110px repeat(${sessions.length}, 1fr)` }}>
                            {eventRows.flatMap((type, rowIdx) => [
                                <div
                                    key={`evt-lbl-${type}`}
                                    className={`flex items-center gap-1.5 px-3.5 py-2.5 ${rowIdx < eventRows.length - 1 ? 'border-b border-black/5 dark:border-[#585d61]' : ''}`}
                                >
                                    <div
                                        className="h-2 w-2 flex-shrink-0 rounded-full"
                                        style={{
                                            backgroundColor: EVENT_MARKER_COLORS[type] ?? 'var(--color-muted)',
                                        }}
                                    />
                                    <span className="text-[11px] font-medium uppercase tracking-[0.4px] text-muted">
                                        {type}
                                    </span>
                                </div>,
                                ...sessions.map((s, i) => {
                                    const evt = eventsBySession[i].find((e) => e.type === type);
                                    return (
                                        <div
                                            key={`evt-${s.id}-${type}`}
                                            className={`border-l border-l-black/5 dark:border-l-[#585d61] px-3.5 py-2.5 ${rowIdx < eventRows.length - 1 ? 'border-b border-black/5 dark:border-[#585d61]' : ''}`}
                                        >
                                            <span className="font-mono text-[12px] font-semibold tracking-[-0.2px] text-primary">
                                                {evt ? formatElapsed(evt.time_sec) : '—'}
                                            </span>
                                            {evt?.temp_c != null && (
                                                <span className="ml-1.5 font-mono text-[11px] text-muted">
                                                    {Math.round(evt.temp_c)}°
                                                </span>
                                            )}
                                        </div>
                                    );
                                }),
                            ])}
                        </div>
                    </div>
                )}
            </div>
        </ModalShell>
    );
};
