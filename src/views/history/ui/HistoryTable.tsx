import { sessionBeanName } from '@entities/roast';
import { summarizeSessionEvents } from '@entities/roast-profile';
import { formatTemp, type TemperatureUnit, useRoastSettings } from '@features/active-roast';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatDateShort, formatDuration } from '@shared/lib/format';
import { sessionRoastMetrics } from '@shared/lib/roast-delta';
import { computeRoastWeights } from '@shared/lib/roastWeight';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { Badge } from '@shared/ui/Badge';
import { TablePagination } from '@shared/ui/TablePagination';
import { COMPARE_COLORS } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { BookmarkPlus, Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HistorySessionChart } from './HistorySessionChart';
import { OutputWeightEditor } from './OutputWeightEditor';
import { RecordSections } from './RecordSections';
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

const detailTitleCls = 'm-0 mb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-muted';

/** Row actions stay visible (not hover-only) and pinned right when the table scrolls horizontally. */
const stickyActionsCls = 'sticky right-0 z-[1] bg-main-bg text-right';
const rowActionCls =
    'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-muted transition focus-visible:outline-2 focus-visible:outline-(--color-primary)';

// ── Types ──

export type SortKey = 'date' | 'bean' | 'duration' | 'drop' | 'level' | 'profile' | 'weight';

type Column = {
    key: SortKey | null;
    label: string;
    width: string;
    /** Keeps uppercase header text from compressing into the next column. */
    minWidth?: string;
    sortable: boolean;
    hideOnMd?: boolean;
    render: (s: RoastSessionWithRelations) => ReactNode;
};

const columnsFor = (unit: TemperatureUnit): Column[] => [
    { key: 'date', label: 'Date', width: '100px', sortable: true, render: (s) => formatDateShort(s.roasted_at) },
    {
        key: 'bean',
        label: 'Bean',
        width: '200px',
        sortable: true,
        render: (s) => sessionBeanName(s) ?? '—',
    },
    {
        key: 'profile',
        label: 'Profile',
        width: '150px',
        sortable: false,
        hideOnMd: true,
        render: (s) => s.roast_profiles?.name ?? '—',
    },
    {
        key: 'weight',
        label: 'Weight',
        width: '90px',
        sortable: false,
        render: (s) => `${s.weight_grams}g`,
    },
    {
        key: null,
        label: 'charge',
        width: '160px',
        minWidth: '160px',
        sortable: false,
        render: (s) =>
            formatTemp(summarizeSessionEvents(parseStoredRoastEvents(s.events), s).charge_temp_celsius, unit),
    },
    {
        key: 'drop',
        label: 'Drop',
        width: '184px',
        minWidth: '184px',
        sortable: true,
        render: (s) => formatTemp(s.drop_temp_celsius, unit),
    },
    {
        key: 'duration',
        label: 'Duration',
        width: '90px',
        sortable: true,
        render: (s) => formatDuration(sessionRoastMetrics(s).roastDurationSec),
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
            const dtr = sessionRoastMetrics(s).dtrPct;
            return dtr != null ? `${dtr.toFixed(1)}%` : '—';
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
        width: '112px',
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
    const { temperatureUnit: unit } = useRoastSettings();

    return (
        <tr className="border-b border-border bg-surface-warm/30">
            <td colSpan={11} className="p-0">
                {/* Pinned to the visible scroll width so detail, inputs and buttons never slide off-screen. */}
                <div
                    id={`history-detail-${session.id}`}
                    data-testid="history-detail"
                    className="sticky left-0 w-[100cqw] max-w-full px-4 py-4 md:px-6"
                >
                    <h3 className={detailTitleCls}>{t('history.expanded.summary')}</h3>
                    <div className="grid grid-cols-2 items-start gap-x-6 gap-y-3 border-b border-border-subtle pb-2 @3xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(240px,1.5fr)]">
                        {[
                            { label: t('history.expanded.origin'), value: session.beans?.origin ?? '—' },
                            {
                                label: t('history.expanded.chargeTemp'),
                                value: formatTemp(
                                    summarizeSessionEvents(parseStoredRoastEvents(session.events), session)
                                        .charge_temp_celsius,
                                    unit,
                                ),
                            },
                            {
                                label: t('history.expanded.dropTemp'),
                                value: formatTemp(session.drop_temp_celsius, unit),
                            },
                            {
                                label: t('history.expanded.duration'),
                                value: formatDuration(sessionRoastMetrics(session).roastDurationSec),
                            },
                        ].map(({ label, value }) => (
                            <div key={label} className="min-w-0">
                                <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {label}
                                </div>
                                <div className="break-words font-mono text-[13px] font-medium tracking-[0.14px] text-primary">
                                    {value}
                                </div>
                            </div>
                        ))}
                        <OutputWeightEditor session={session} />
                    </div>

                    <SessionScorecard session={session} />

                    <HistorySessionChart session={session} />

                    <RecordSections session={session} />

                    <section className="mt-3 rounded-lg border border-border-subtle bg-main-bg px-4 py-3">
                        <h3 className={detailTitleCls}>{t('history.expanded.notes')}</h3>
                        <div className="min-w-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed tracking-[0.14px] text-secondary">
                            {session.notes || <span className="text-muted">{t('history.noNotes')}</span>}
                        </div>
                    </section>
                </div>
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
    const unit = useRoastSettings().temperatureUnit;
    const columns = columnsFor(unit);
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, filteredTotal);

    const colLabel = (key: string) => {
        const map: Record<string, string> = {
            date: t('history.table.date'),
            bean: t('history.table.bean'),
            profile: t('history.table.profile'),
            weight: t('history.table.weight'),
            charge: t('history.table.chargeTemp'),
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
        <div className="@container overflow-x-auto rounded-lg bg-main-bg dark:border dark:border-[#585d61] [-webkit-overflow-scrolling:touch]">
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
                                    className={`px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.5px] text-muted select-none whitespace-nowrap ${responsiveClass} ${col.sortable ? 'cursor-pointer' : 'cursor-default'} ${col.key === null && col.label === '' ? stickyActionsCls : ''}`}
                                    style={{ width: col.width, minWidth: col.minWidth }}
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
                                            ? stickyActionsCls
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
                                                style={{ width: col.width, minWidth: col.minWidth }}
                                            >
                                                {isActions ? (
                                                    <span className="inline-flex items-center">
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onSaveAsProfile(session.id);
                                                            }}
                                                            className={`${rowActionCls} hover:bg-surface hover:text-primary`}
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
                                                            className={`${rowActionCls} hover:bg-[rgba(254,226,226,0.5)] hover:text-[#dc2626]`}
                                                            aria-label={t('history.delete.title')}
                                                            title={t('history.delete.title')}
                                                        >
                                                            <Trash2 size={14} strokeWidth={2} />
                                                        </button>
                                                        {!compareMode && (
                                                            <button
                                                                type="button"
                                                                data-testid="history-row-toggle"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    onRowClick(session.id);
                                                                }}
                                                                className={`${rowActionCls} hover:bg-surface hover:text-primary`}
                                                                aria-expanded={isExpanded}
                                                                aria-controls={
                                                                    isExpanded
                                                                        ? `history-detail-${session.id}`
                                                                        : undefined
                                                                }
                                                                aria-label={t(
                                                                    isExpanded
                                                                        ? 'history.expanded.hide'
                                                                        : 'history.expanded.show',
                                                                )}
                                                                title={t(
                                                                    isExpanded
                                                                        ? 'history.expanded.hide'
                                                                        : 'history.expanded.show',
                                                                )}
                                                            >
                                                                {isExpanded ? (
                                                                    <ChevronUp size={14} strokeWidth={2} />
                                                                ) : (
                                                                    <ChevronDown size={14} strokeWidth={2} />
                                                                )}
                                                            </button>
                                                        )}
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

                <TablePagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
            </div>
        </div>
    );
};
