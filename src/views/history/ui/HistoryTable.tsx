import { useHistoryChart } from '@entities/roast';
import { useResolvedProfileCurve, useRoastProfiles } from '@entities/roast-profile';
import { parseStoredRoastEvents, storedEventsToMarkers } from '@features/active-roast/lib/serialize-roast-events';
import { RoastTempChart } from '@features/active-roast/ui/RoastTempChart';
import { formatDateShort, formatDuration } from '@shared/lib/format';
import { deriveSessionDevMetrics } from '@shared/lib/roast-delta';
import { computeRoastWeights } from '@shared/lib/roastWeight';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { Badge } from '@shared/ui/Badge';
import { COMPARE_COLORS } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { BookmarkPlus, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { OutputWeightEditor } from './OutputWeightEditor';
import { SessionScorecard } from './SessionScorecard';

// ── Constants ──

const levelColor: Record<string, string> = {
    Light: 'var(--color-palette-yellow)',
    'Medium-Light': 'var(--color-palette-teal)',
    Medium: 'var(--color-palette-blue)',
    'Medium-Dark': 'var(--color-palette-purple)',
    Dark: 'var(--color-palette-violet)',
};

const levelBg: Record<string, string> = {
    Light: 'color-mix(in srgb, var(--color-palette-yellow) 20%, transparent)',
    'Medium-Light': 'color-mix(in srgb, var(--color-palette-teal) 15%, transparent)',
    Medium: 'color-mix(in srgb, var(--color-palette-blue) 12%, transparent)',
    'Medium-Dark': 'color-mix(in srgb, var(--color-palette-purple) 12%, transparent)',
    Dark: 'color-mix(in srgb, var(--color-palette-violet) 12%, transparent)',
    'Dark-Light': 'color-mix(in srgb, var(--color-palette-violet) 12%, transparent)',
};

// ── Types ──

export type SortKey = 'date' | 'bean' | 'duration' | 'drop' | 'level' | 'profile' | 'weight';

type Column = {
    key: SortKey | null;
    label: string;
    width: string;
    sortable: boolean;
    hideOnMd?: boolean;
    render: (s: RoastSessionWithRelations) => ReactNode;
};

const columns: Column[] = [
    { key: 'date', label: 'Date', width: '100px', sortable: true, render: (s) => formatDateShort(s.roasted_at) },
    { key: 'bean', label: 'Bean', width: '200px', sortable: true, render: (s) => s.beans?.name ?? '—' },
    {
        key: 'profile',
        label: 'Profile',
        width: '150px',
        sortable: false,
        hideOnMd: true,
        render: (s) => s.roast_profiles?.name ?? '—',
    },
    { key: 'weight', label: 'Weight', width: '90px', sortable: false, render: (s) => `${s.weight_grams}g` },
    {
        key: 'drop',
        label: 'Drop',
        width: '80px',
        sortable: true,
        render: (s) => (s.drop_temp_celsius != null ? `${s.drop_temp_celsius}°C` : '—'),
    },
    {
        key: 'duration',
        label: 'Duration',
        width: '90px',
        sortable: true,
        render: (s) => formatDuration(s.duration_seconds),
    },
    {
        key: null,
        label: 'loss',
        width: '80px',
        sortable: false,
        hideOnMd: true,
        render: (s) => {
            const w = computeRoastWeights(s.weight_grams, s.output_weight_grams, s.roast_level);
            return w.inputKg > 0 ? `${w.lossRate.toFixed(1)}%` : '—';
        },
    },
    {
        key: null,
        label: 'dtr',
        width: '70px',
        sortable: false,
        hideOnMd: true,
        render: (s) => {
            const dev = deriveSessionDevMetrics(parseStoredRoastEvents(s.events), s.duration_seconds);
            return dev.devPct != null ? `${dev.devPct.toFixed(1)}%` : '—';
        },
    },
    {
        key: 'level',
        label: 'Level',
        width: '110px',
        sortable: true,
        render: (s) =>
            s.roast_level ? (
                <Badge
                    color={levelColor[s.roast_level] || 'var(--color-muted)'}
                    bg={levelBg[s.roast_level] || 'var(--color-surface)'}
                >
                    {s.roast_level}
                </Badge>
            ) : (
                <span className="text-muted">—</span>
            ),
    },
    {
        key: null,
        label: '',
        width: '80px',
        sortable: false,
        render: () => null,
    },
];

// ── SortIcon ──

type SortIconProps = {
    col: SortKey;
    sortKey: SortKey;
    sortAsc: boolean;
};

function SortIcon({ col, sortKey, sortAsc }: SortIconProps): ReactNode {
    if (sortKey !== col) {
        return <ChevronDown size={11} strokeWidth={2} color="var(--color-muted)" style={{ opacity: 0.4 }} />;
    }
    return sortAsc ? (
        <ChevronUp size={11} strokeWidth={2.5} color="var(--color-primary)" />
    ) : (
        <ChevronDown size={11} strokeWidth={2.5} color="var(--color-primary)" />
    );
}

// ── ExpandedRow ──

type ExpandedRowProps = {
    session: RoastSessionWithRelations;
};

function ExpandedRow({ session }: ExpandedRowProps): ReactNode {
    const { t } = useTranslation();
    const { xs, btActual, etActual, rorActual, isLoading, isError } = useHistoryChart(session.tsv_path ?? null);
    const eventMarkers = useMemo(() => storedEventsToMarkers(parseStoredRoastEvents(session.events)), [session.events]);

    // 세션의 타깃 프로파일 커브 오버레이 (실측 TSV 우선, 없으면 synthetic)
    const { data: profiles = [] } = useRoastProfiles(session.user_id);
    const profile = session.profile_id ? (profiles.find((p) => p.id === session.profile_id) ?? null) : null;
    const { points: targetPoints } = useResolvedProfileCurve(profile);
    const { targetXs, targetBt } = useMemo(
        () => ({ targetXs: targetPoints.map((p) => p.t), targetBt: targetPoints.map((p) => p.bt) }),
        [targetPoints],
    );

    return (
        <tr className="border-b border-border-subtle dark:border-[#585d61] bg-[rgba(245,242,239,0.3)] dark:bg-[rgba(38,43,48,0.3)]">
            <td colSpan={10} className="px-4 py-4 md:px-6">
                <div className="grid items-start gap-4 md:grid-cols-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_2fr]">
                    {[
                        { label: t('history.expanded.origin'), value: session.beans?.origin ?? '—' },
                        {
                            label: t('history.expanded.dropTemp'),
                            value: session.drop_temp_celsius != null ? `${session.drop_temp_celsius}°C` : '—',
                        },
                        { label: t('history.expanded.duration'), value: formatDuration(session.duration_seconds) },
                    ].map(({ label, value }) => (
                        <div key={label} className="mb-2">
                            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                {label}
                            </div>
                            <div className="font-mono text-[13px] font-medium tracking-[0.14px] text-primary">
                                {value}
                            </div>
                        </div>
                    ))}
                    <OutputWeightEditor session={session} />
                    <div className="mb-2 md:col-span-3 lg:col-auto">
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('history.expanded.notes')}
                        </div>
                        <div className="text-[13px] leading-normal tracking-[0.14px] text-secondary">
                            {session.notes || <span className="text-muted">{t('history.noNotes')}</span>}
                        </div>
                    </div>
                </div>

                <SessionScorecard session={session} />

                {session.tsv_path && (
                    <div className="mt-4">
                        {isLoading ? (
                            <div className="flex h-[220px] items-center justify-center text-xs text-muted">
                                {t('history.expanded.chartLoading')}
                            </div>
                        ) : isError ? (
                            <div className="flex h-[550px] items-center justify-center text-xs text-muted">
                                {t('history.expanded.chartUnavailable')}
                            </div>
                        ) : (
                            <RoastTempChart
                                xs={xs}
                                btActual={btActual}
                                etActual={etActual}
                                rorActual={rorActual}
                                btTarget={[]}
                                currentTimeSec={0}
                                eventMarkers={eventMarkers}
                                showTargetCurve={targetXs.length > 0}
                                targetXs={targetXs}
                                targetBt={targetBt}
                                showRoRET={false}
                                height={550}
                            />
                        )}
                    </div>
                )}
            </td>
        </tr>
    );
}

// ── HistoryTable ──

interface HistoryTableProps {
    sessions: RoastSessionWithRelations[];
    total: number;
    filteredTotal: number;
    expandedId: string | null;
    compareMode: boolean;
    compareIds: string[];
    onRowClick: (id: string) => void;
    onDeleteClick: (id: string) => void;
    onSaveAsProfile: (id: string) => void;
    sortKey: SortKey;
    sortAsc: boolean;
    onSort: (key: SortKey) => void;
    page: number;
    totalPages: number;
    pageSize: number;
    onPageChange: (p: number) => void;
}

export const HistoryTable = ({
    sessions,
    total,
    filteredTotal,
    expandedId,
    compareMode,
    compareIds,
    onRowClick,
    onDeleteClick,
    onSaveAsProfile,
    sortKey,
    sortAsc,
    onSort,
    page,
    totalPages,
    pageSize,
    onPageChange,
}: HistoryTableProps): ReactNode => {
    const { t } = useTranslation();
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, filteredTotal);

    const colLabel = (key: string) => {
        const map: Record<string, string> = {
            date: t('history.table.date'),
            bean: t('history.table.bean'),
            profile: t('history.table.profile'),
            weight: t('history.table.weight'),
            drop: t('history.table.dropTemp'),
            duration: t('history.table.duration'),
            loss: t('history.table.loss'),
            dtr: t('history.table.dtr'),
            level: t('history.table.level'),
        };
        return map[key] || key;
    };

    const getCellTitle = (col: Column, session: RoastSessionWithRelations): string | undefined => {
        if (col.key === 'level') {
            return session.roast_level ?? '—';
        }
        const rendered = col.render(session);
        return typeof rendered === 'string' ? rendered : undefined;
    };

    return (
        <div className="overflow-x-auto rounded-lg bg-main-bg dark:border dark:border-[#585d61] [-webkit-overflow-scrolling:touch]">
            <table className="min-w-250 w-full table-fixed border-collapse md:min-w-200 lg:min-w-250">
                <thead>
                    <tr className="border-b border-border-subtle dark:border-[#585d61]">
                        {compareMode && <th style={{ width: '40px' }} />}
                        {columns.map((col, colIdx) => {
                            const responsiveClass = col.hideOnMd ? 'md:hidden lg:table-cell' : '';
                            return (
                                <th
                                    key={col.key || `col-${colIdx}`}
                                    onClick={() => col.sortable && col.key && onSort(col.key)}
                                    className={`px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.5px] text-muted select-none whitespace-nowrap ${responsiveClass} ${col.sortable ? 'cursor-pointer' : 'cursor-default'}`}
                                    style={{ width: col.width }}
                                >
                                    <span className="flex items-center gap-1 whitespace-nowrap">
                                        {colLabel(col.key || col.label)}
                                        {col.sortable && col.key && (
                                            <SortIcon col={col.key} sortKey={sortKey} sortAsc={sortAsc} />
                                        )}
                                    </span>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {sessions.map((session) => {
                        const isExpanded = !compareMode && expandedId === session.id;
                        const compareIdx = compareIds.indexOf(session.id);
                        return (
                            <Fragment key={session.id}>
                                <tr
                                    onClick={() => onRowClick(session.id)}
                                    className={`group cursor-pointer border-b border-border-subtle dark:border-[#585d61] transition ${isExpanded ? 'bg-[rgba(245,245,245,0.5)] dark:bg-[rgba(38,43,48,0.5)]' : 'hover:bg-[rgba(245,242,239,0.45)] dark:hover:bg-[rgba(38,43,48,0.45)]'}`}
                                >
                                    {compareMode && (
                                        <td className="px-3 py-3" style={{ width: '40px' }}>
                                            <div
                                                className="flex h-4 w-4 items-center justify-center rounded border transition"
                                                style={
                                                    compareIdx >= 0
                                                        ? {
                                                              backgroundColor:
                                                                  COMPARE_COLORS[compareIdx % COMPARE_COLORS.length],
                                                              borderColor:
                                                                  COMPARE_COLORS[compareIdx % COMPARE_COLORS.length],
                                                          }
                                                        : { borderColor: 'var(--color-muted)' }
                                                }
                                            >
                                                {compareIdx >= 0 && <Check size={11} strokeWidth={3} color="#fff" />}
                                            </div>
                                        </td>
                                    )}
                                    {columns.map((col, idx) => {
                                        const isActions = col.key === null && col.label === '';
                                        const cellClass = isActions
                                            ? 'text-right'
                                            : col.key === 'date'
                                              ? 'font-mono text-muted'
                                              : col.key === 'bean'
                                                ? 'font-medium tracking-[0.14px] text-primary'
                                                : 'tracking-[0.14px] text-secondary';
                                        const responsiveClass = col.hideOnMd ? 'md:hidden lg:table-cell' : '';
                                        const cellTitle = getCellTitle(col, session);
                                        return (
                                            <td
                                                key={col.key || idx}
                                                title={cellTitle}
                                                className={`overflow-hidden px-3 py-3 text-[13px] whitespace-nowrap ${cellClass} ${responsiveClass}`}
                                                style={{ width: col.width }}
                                            >
                                                {isActions ? (
                                                    <span className="inline-flex items-center">
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onSaveAsProfile(session.id);
                                                            }}
                                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-surface hover:text-primary group-hover:opacity-100 focus:opacity-100"
                                                            aria-label={t('history.saveAsProfile')}
                                                            title={t('history.saveAsProfile')}
                                                        >
                                                            <BookmarkPlus size={14} strokeWidth={2} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onDeleteClick(session.id);
                                                            }}
                                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted opacity-0 transition hover:bg-[rgba(254,226,226,0.5)] hover:text-[#dc2626] group-hover:opacity-100 focus:opacity-100"
                                                            aria-label={t('history.delete.title')}
                                                        >
                                                            <Trash2 size={14} strokeWidth={2} />
                                                        </button>
                                                    </span>
                                                ) : (
                                                    col.render(session)
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                                {isExpanded && <ExpandedRow session={session} />}
                            </Fragment>
                        );
                    })}
                </tbody>
            </table>

            <div className="flex flex-col gap-3 border-t border-border-subtle dark:border-[#585d61] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs tracking-[0.14px] text-muted">
                    {filteredTotal === 0
                        ? t('history.noSessionsFound')
                        : `${t('history.pagination', { start, end, total: filteredTotal })}${filteredTotal < total ? t('history.filteredFrom', { count: total }) : ''}`}
                </span>

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onPageChange(page - 1)}
                        disabled={page === 1}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted transition hover:bg-surface hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={13} strokeWidth={2} />
                    </button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                        .reduce<(number | '…')[]>((acc, p, i, arr) => {
                            if (i > 0 && p - arr[i - 1] > 1) acc.push('…');
                            acc.push(p);
                            return acc;
                        }, [])
                        .map((item, i) =>
                            item === '…' ? (
                                <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted">
                                    …
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    key={item}
                                    onClick={() => onPageChange(item)}
                                    className={`h-6 min-w-6 rounded px-1.5 text-xs font-medium transition ${
                                        page === item
                                            ? 'bg-surface-warm-solid text-primary'
                                            : 'text-muted hover:bg-surface hover:text-secondary'
                                    }`}
                                >
                                    {item}
                                </button>
                            ),
                        )}

                    <button
                        type="button"
                        onClick={() => onPageChange(page + 1)}
                        disabled={page === totalPages || totalPages === 0}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted transition hover:bg-surface hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronRight size={13} strokeWidth={2} />
                    </button>
                </div>
            </div>
        </div>
    );
};
