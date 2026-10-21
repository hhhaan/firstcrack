import { summarizeSessionEvents } from '@entities/roast-profile';
import { formatTemp, type TemperatureUnit, useRoastSettings } from '@features/active-roast';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatDateShort, formatDuration } from '@shared/lib/format';
import { sessionRoastMetrics } from '@shared/lib/roast-delta';
import { computeRoastWeights } from '@shared/lib/roastWeight';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { Badge } from '@shared/ui/Badge';
import { TablePagination } from '@shared/ui/TablePagination';
import { COMPARE_COLORS } from '@widgets/profile-curve-chart/ui/ProfileCurveChart';
import { Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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

/** Row actions stay visible (not hover-only) and pinned right when the table scrolls horizontally. */
const stickyActionsCls = 'sticky right-0 z-[1] bg-main-bg text-right';
const rowActionCls =
    'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-muted transition focus-visible:outline-2 focus-visible:outline-(--color-primary)';

// ── Types ──

export type SortKey = 'date' | 'bean' | 'duration' | 'drop' | 'level' | 'profile' | 'weight';

type Column = {
    key: SortKey | null;
    label: string;
    /** Omitted column takes the leftover table width (table-layout: fixed). */
    width?: string;
    /** Keeps uppercase header text from compressing into the next column. */
    minWidth?: string;
    sortable: boolean;
    hideOnMd?: boolean;
    render: (s: RoastSessionWithRelations) => ReactNode;
};

const columnsFor = (unit: TemperatureUnit): Column[] => [
    { key: 'date', label: 'Date', width: '100px', sortable: true, render: (s) => formatDateShort(s.roasted_at) },
    {
        key: null,
        label: 'roastTitle',
        width: '180px',
        sortable: false,
        render: (s) => sessionRoastTitle(s) || '—',
    },
    {
        key: 'bean',
        label: 'Bean',
        sortable: true,
        render: (s) => s.beans?.name?.trim() || '—',
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
        width: '112px',
        minWidth: '112px',
        sortable: false,
        render: (s) =>
            formatTemp(summarizeSessionEvents(parseStoredRoastEvents(s.events), s).charge_temp_celsius, unit),
    },
    {
        key: 'drop',
        label: 'Drop',
        width: '112px',
        minWidth: '112px',
        sortable: true,
        render: (s) => formatTemp(s.drop_temp_celsius, unit),
    },
    {
        key: 'duration',
        label: 'Duration',
        width: '76px',
        minWidth: '76px',
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
        width: '48px',
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

// ── HistoryTable ──

interface HistoryTableProps {
    sessions: RoastSessionWithRelations[];
    total: number;
    filteredTotal: number;
    compareMode: boolean;
    compareIds: string[];
    onRowClick: (id: string) => void;
    onDeleteClick: (id: string) => void;
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
    compareMode,
    compareIds,
    onRowClick,
    onDeleteClick,
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
    // Bean has no width so it absorbs leftover. Other columns stay at their px width.
    const beanMinPx = 180;
    const tableMinPx =
        (compareMode ? 40 : 0) +
        columns.reduce((sum, col) => sum + (col.width ? Number.parseInt(col.width, 10) : beanMinPx), 0);
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, filteredTotal);

    const colLabel = (key: string) => {
        const map: Record<string, string> = {
            date: t('history.table.date'),
            bean: t('activeRoast.summary.bean'),
            roastTitle: t('history.recordText.title'),
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
        <div className="@container overflow-x-auto rounded-2xl border border-border bg-main-bg [-webkit-overflow-scrolling:touch]">
            <table className="w-full table-fixed border-collapse" style={{ minWidth: tableMinPx }}>
                <colgroup>
                    {compareMode && <col style={{ width: '40px' }} />}
                    {columns.map((col, colIdx) => (
                        <col key={col.key || `col-${colIdx}`} style={col.width ? { width: col.width } : undefined} />
                    ))}
                </colgroup>
                <thead>
                    <tr className="border-b border-divider dark:border-border">
                        {compareMode && <th style={{ width: '40px' }} />}
                        {columns.map((col, colIdx) => {
                            const responsiveClass = col.hideOnMd ? 'md:hidden lg:table-cell' : '';
                            return (
                                <th
                                    key={col.key || `col-${colIdx}`}
                                    onClick={() => col.sortable && col.key && onSort(col.key)}
                                    className={`h-12 px-4 py-0 text-left text-sm font-medium leading-5 text-muted select-none whitespace-nowrap ${responsiveClass} ${col.sortable ? 'cursor-pointer' : 'cursor-default'} ${col.key === null && col.label === '' ? stickyActionsCls : ''}`}
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
                        const compareIdx = compareIds.indexOf(session.id);
                        return (
                            <tr
                                key={session.id}
                                data-testid="history-open-row"
                                tabIndex={0}
                                onClick={() => onRowClick(session.id)}
                                onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget) return;
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    onRowClick(session.id);
                                }}
                                className="group cursor-pointer border-b border-divider transition hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-(--color-primary) dark:border-border dark:hover:bg-surface-elevated"
                            >
                                {compareMode && (
                                    <td className="px-4 py-4" style={{ width: '40px' }}>
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
                                {columns.map((col) => {
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
                                            key={col.key ?? 'actions'}
                                            title={cellTitle}
                                            className={`overflow-hidden px-4 py-4 text-sm whitespace-nowrap ${cellClass} ${responsiveClass}`}
                                            style={{ width: col.width, minWidth: col.minWidth }}
                                        >
                                            {isActions ? (
                                                <span className="inline-flex items-center">
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
                                                </span>
                                            ) : (
                                                col.render(session)
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div className="flex flex-col gap-3 border-t border-divider dark:border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
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
