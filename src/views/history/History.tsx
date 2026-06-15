import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, Filter, ChevronDown, ChevronUp, Download, FileText, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRoastSessions, useRoastSessionsPaginated } from '@entities/roast';
import { useProfile } from '@entities/profile';
import { PageLayout } from '@shared/ui/PageLayout';
import { PageHeader } from '@shared/ui/PageHeader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { MonthlyProductionReport } from '@views/reports/MonthlyProductionReport';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { sessionsToCsv } from '@features/export-csv';
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { downloadDir } from '@tauri-apps/api/path';
import { useAuthStore } from '@shared/store/auth';

const levelColor: Record<string, string> = {
    Light: '#a16207',
    'Medium-Light': '#92400e',
    Medium: '#7c2d12',
    'Medium-Dark': '#5c1a0b',
    Dark: '#3b0f07',
};

const levelBg: Record<string, string> = {
    Light: 'rgba(254,243,199,0.8)',
    'Medium-Light': 'rgba(254,231,200,0.8)',
    Medium: 'rgba(253,220,198,0.8)',
    'Medium-Dark': 'rgba(252,200,180,0.8)',
    Dark: 'rgba(240,170,150,0.8)',
    'Dark-Light': 'rgba(240,170,150,0.8)',
};

const formatDuration = (seconds: number | null): string => {
    if (seconds == null) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const formatDate = (iso: string | null): string => {
    if (!iso) return '—';
    return iso.slice(2, 10); // YY-MM-DD
};

type SortKey = 'date' | 'bean' | 'duration' | 'drop' | 'level';

type Column = {
    key: SortKey | null;
    label: string;
    width: string;
    sortable: boolean;
    render: (s: RoastSessionWithRelations) => ReactNode;
};

const columns: Column[] = [
    { key: 'date', label: 'Date', width: '100px', sortable: true, render: (s) => formatDate(s.roasted_at) },
    { key: 'bean', label: 'Bean', width: '200px', sortable: true, render: (s) => s.beans?.name ?? '—' },
    { key: null, label: 'Profile', width: '150px', sortable: false, render: (s) => s.roast_profiles?.name ?? '—' },
    { key: null, label: 'Weight', width: '90px', sortable: false, render: (s) => `${s.weight_grams}g` },
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
        key: 'level',
        label: 'Level',
        width: '110px',
        sortable: true,
        render: (s) =>
            s.roast_level ? (
                <span
                    className="text-[11px] font-medium px-2 py-0.75 rounded-full whitespace-nowrap tracking-[0.14px]"
                    style={{
                        color: levelColor[s.roast_level] || 'var(--color-muted)',
                        background: levelBg[s.roast_level] || 'var(--color-surface)',
                    }}
                >
                    {s.roast_level}
                </span>
            ) : (
                <span className="text-muted">—</span>
            ),
    },
];

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

type ExpandedRowProps = {
    session: RoastSessionWithRelations;
};

function ExpandedRow({ session }: ExpandedRowProps): ReactNode {
    return (
        <tr className="border-b border-border-subtle bg-[rgba(245,242,239,0.3)]">
            <td colSpan={columns.length} className="px-4 py-4 md:px-6">
                <div className="grid items-start gap-4 md:grid-cols-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_2fr]">
                    {[
                        { label: 'Origin', value: session.beans?.origin ?? '—' },
                        {
                            label: 'Drop Temp',
                            value: session.drop_temp_celsius != null ? `${session.drop_temp_celsius}°C` : '—',
                        },
                        { label: 'Duration', value: formatDuration(session.duration_seconds) },
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
                    <div className="mb-2 md:col-span-3 lg:col-auto">
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">Notes</div>
                        <div className="text-[13px] leading-normal tracking-[0.14px] text-secondary">
                            {session.notes || <span className="text-muted">No notes recorded.</span>}
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    );
}
const HistoryTable = ({
    sessions,
    total,
    filteredTotal,
    expandedId,
    onRowClick,
    sortKey,
    sortAsc,
    onSort,
    page,
    totalPages,
    pageSize,
    onPageChange,
}: {
    sessions: RoastSessionWithRelations[];
    total: number;
    filteredTotal: number;
    expandedId: string | null;
    onRowClick: (id: string) => void;
    sortKey: SortKey;
    sortAsc: boolean;
    onSort: (key: SortKey) => void;
    page: number;
    totalPages: number;
    pageSize: number;
    onPageChange: (p: number) => void;
}): ReactNode => {
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, filteredTotal);

    const getCellTitle = (col: Column, session: RoastSessionWithRelations): string | undefined => {
        if (col.key === 'level') {
            return session.roast_level ?? '—';
        }
        const rendered = col.render(session);
        return typeof rendered === 'string' ? rendered : undefined;
    };

    return (
        <div className="overflow-x-auto rounded-lg bg-main-bg [-webkit-overflow-scrolling:touch]">
            <table className="min-w-250 w-full table-fixed border-collapse md:min-w-200 lg:min-w-250">
                <thead>
                    <tr className="border-b border-border-subtle">
                        {columns.map((col) => {
                            const responsiveClass = col.label === 'Profile' ? 'md:hidden lg:table-cell' : '';
                            return (
                                <th
                                    key={col.label}
                                    onClick={() => col.sortable && col.key && onSort(col.key as SortKey)}
                                    className={`px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.5px] text-muted select-none whitespace-nowrap ${responsiveClass} ${col.sortable ? 'cursor-pointer' : 'cursor-default'}`}
                                    style={{ width: col.width }}
                                >
                                    <span className="flex items-center gap-1 whitespace-nowrap">
                                        {col.label}
                                        {col.sortable && col.key && (
                                            <SortIcon col={col.key as SortKey} sortKey={sortKey} sortAsc={sortAsc} />
                                        )}
                                    </span>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {sessions.map((session) => {
                        const isExpanded = expandedId === session.id;
                        return (
                            <Fragment key={session.id}>
                                <tr
                                    onClick={() => onRowClick(session.id)}
                                    className={`cursor-pointer border-b border-border-subtle transition ${isExpanded ? 'bg-[rgba(245,245,245,0.5)]' : 'hover:bg-[rgba(245,242,239,0.45)]'}`}
                                >
                                    {columns.map((col, idx) => {
                                        const cellClass =
                                            col.key === 'date'
                                                ? 'font-mono text-muted'
                                                : col.key === 'bean'
                                                  ? 'font-medium tracking-[0.14px] text-primary'
                                                  : 'tracking-[0.14px] text-secondary';
                                        const responsiveClass =
                                            col.label === 'Profile' ? 'md:hidden lg:table-cell' : '';
                                        const cellTitle = getCellTitle(col, session);
                                        return (
                                            <td
                                                key={col.key || idx}
                                                title={cellTitle}
                                                className={`overflow-hidden px-3 py-3 text-[13px] whitespace-nowrap ${cellClass} ${responsiveClass}`}
                                                style={{ width: col.width }}
                                            >
                                                {col.render(session)}
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

            <div className="flex flex-col gap-3 border-t border-border-subtle px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs tracking-[0.14px] text-muted">
                    {filteredTotal === 0
                        ? 'No sessions found'
                        : `${start}–${end} of ${filteredTotal}${filteredTotal < total ? ` (filtered from ${total})` : ''}`}
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
                            if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('…');
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
                                    key={item}
                                    onClick={() => onPageChange(item as number)}
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

const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

const FilterDropdown = ({
    label,
    value,
    options,
    onSelect,
}: {
    label: string;
    value: string;
    options: string[];
    onSelect: (v: string) => void;
}): ReactNode => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const isActive = value !== 'all';

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg border-0 px-3 py-2 text-[13px] font-medium tracking-[0.14px] transition ${
                    isActive
                        ? 'bg-surface-warm-solid text-primary'
                        : 'bg-surface text-secondary hover:bg-surface-warm-solid hover:text-primary'
                }`}
            >
                <Filter size={12} strokeWidth={2} className={isActive ? 'text-primary' : 'text-muted'} />
                {isActive ? value : label}
                <ChevronDown size={11} strokeWidth={2} className={isActive ? 'text-primary' : 'text-muted'} />
            </button>

            {open && (
                <div className="absolute top-full left-0 z-50 mt-1 min-w-35 rounded-lg bg-main-bg py-1">
                    <button
                        onClick={() => {
                            onSelect('all');
                            setOpen(false);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-[13px] tracking-[0.14px] transition hover:bg-surface ${value === 'all' ? 'font-medium text-primary' : 'text-secondary'}`}
                    >
                        {label}
                    </button>
                    {options.map((opt) => (
                        <button
                            key={opt}
                            onClick={() => {
                                onSelect(opt);
                                setOpen(false);
                            }}
                            className={`w-full px-3 py-1.5 text-left text-[13px] tracking-[0.14px] transition hover:bg-surface ${value === opt ? 'font-medium text-primary' : 'text-secondary'}`}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

type DatePreset = 'all' | 'this-month' | 'last-month' | '3-months' | '6-months' | 'this-year' | 'custom';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
    { value: 'all', label: 'All Time' },
    { value: 'this-month', label: 'This Month' },
    { value: 'last-month', label: 'Last Month' },
    { value: '3-months', label: 'Last 3 Months' },
    { value: '6-months', label: 'Last 6 Months' },
    { value: 'this-year', label: 'This Year' },
    { value: 'custom', label: 'Custom Range' },
];

const getPresetYMRange = (preset: DatePreset): { fromYM: string; toYM: string } | null => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const fmt = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;
    if (preset === 'this-month') return { fromYM: fmt(y, m), toYM: fmt(y, m) };
    if (preset === 'last-month') {
        const d = new Date(y, m - 1, 1);
        return { fromYM: fmt(d.getFullYear(), d.getMonth()), toYM: fmt(d.getFullYear(), d.getMonth()) };
    }
    if (preset === '3-months') {
        const d = new Date(y, m - 2, 1);
        return { fromYM: fmt(d.getFullYear(), d.getMonth()), toYM: fmt(y, m) };
    }
    if (preset === '6-months') {
        const d = new Date(y, m - 5, 1);
        return { fromYM: fmt(d.getFullYear(), d.getMonth()), toYM: fmt(y, m) };
    }
    if (preset === 'this-year') return { fromYM: fmt(y, 0), toYM: fmt(y, m) };
    return null;
};

const MONTHS_KO = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

const DateRangeFilter = ({
    preset,
    fromYM,
    toYM,
    monthOptions,
    onPresetChange,
    onFromYM,
    onToYM,
}: {
    preset: DatePreset;
    fromYM: string;
    toYM: string;
    monthOptions: string[];
    onPresetChange: (p: DatePreset) => void;
    onFromYM: (v: string) => void;
    onToYM: (v: string) => void;
}): ReactNode => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const isActive = preset !== 'all';

    const initFrom = fromYM || (monthOptions[0] ?? '');
    const initTo = toYM || (monthOptions[monthOptions.length - 1] ?? '');
    const [draftFrom, setDraftFrom] = useState(initFrom);
    const [draftTo, setDraftTo] = useState(initTo);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Element;
            const inPanel = ref.current?.contains(target);
            const inPortal = !!target?.closest('[data-radix-popper-content-wrapper]');
            if (!inPanel && !inPortal) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const years = useMemo(
        () => [...new Set(monthOptions.map((ym) => ym.split('-')[0]))].sort((a, b) => Number(b) - Number(a)),
        [monthOptions],
    );

    const fmtLabel = (ym: string) => {
        if (!ym) return '—';
        const [y, m] = ym.split('-');
        return `${y}년 ${parseInt(m)}월`;
    };

    const triggerLabel = (() => {
        if (preset === 'custom' && (fromYM || toYM)) return `${fmtLabel(fromYM)} – ${fmtLabel(toYM)}`;
        return DATE_PRESETS.find((p) => p.value === preset)?.label ?? 'Period';
    })();

    const handlePresetClick = (p: DatePreset) => {
        if (p === 'custom') {
            setDraftFrom(fromYM || initFrom);
            setDraftTo(toYM || initTo);
        }
        onPresetChange(p);
        if (p !== 'custom') setOpen(false);
    };

    const handleApply = () => {
        let f = draftFrom;
        let t = draftTo;
        if (f && t && f > t) {
            [f, t] = [t, f];
        }
        onFromYM(f);
        onToYM(t);
        setOpen(false);
    };

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border-0 px-3 py-2 text-[13px] font-medium tracking-[0.14px] transition ${
                    isActive
                        ? 'bg-surface-warm-solid text-primary'
                        : 'bg-surface text-secondary hover:bg-surface-warm-solid hover:text-primary'
                }`}
            >
                {triggerLabel}
                {isActive ? (
                    <X
                        size={11}
                        strokeWidth={2.5}
                        className="text-muted hover:text-primary"
                        onClick={(e) => {
                            e.stopPropagation();
                            onPresetChange('all');
                            setOpen(false);
                        }}
                    />
                ) : (
                    <ChevronDown size={11} strokeWidth={2} className="text-muted" />
                )}
            </button>

            {open && (
                <div className="absolute top-full left-0 z-50 mt-1 flex rounded-lg bg-main-bg overflow-hidden">
                    {/* 프리셋 목록 */}
                    <div className="flex shrink-0 flex-col gap-0.5 py-2 px-2 w-36">
                        {DATE_PRESETS.map((p) => (
                            <button
                                key={p.value}
                                onClick={() => handlePresetClick(p.value)}
                                className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] tracking-[0.14px] transition hover:bg-surface cursor-pointer border-none bg-transparent ${
                                    preset === p.value ? 'font-semibold text-primary' : 'text-secondary'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* 커스텀 범위 — draft 상태로 관리, Apply 버튼으로만 반영 */}
                    {preset === 'custom' && (
                        <div className="flex flex-col justify-center gap-3 border-l border-border-subtle px-5 py-4 self-stretch">
                            {(
                                [
                                    { label: '시작', val: draftFrom, set: setDraftFrom },
                                    { label: '종료', val: draftTo, set: setDraftTo },
                                ] as const
                            ).map(({ label, val, set }) => {
                                const yr = val ? val.split('-')[0] : '';
                                const mo = val ? val.split('-')[1] : '';
                                return (
                                    <div key={label} className="flex items-center gap-2">
                                        <span className="w-7 shrink-0 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                            {label}
                                        </span>
                                        <Select value={yr} onValueChange={(v) => set(mo ? `${v}-${mo}` : v)}>
                                            <SelectTrigger className="w-24">
                                                <SelectValue placeholder="년도" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {years.map((y) => (
                                                    <SelectItem key={y} value={y}>
                                                        {y}년
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Select value={mo} onValueChange={(v) => set(yr ? `${yr}-${v}` : v)}>
                                            <SelectTrigger className="w-20">
                                                <SelectValue placeholder="월" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {MONTHS_KO.map((name, i) => (
                                                    <SelectItem key={i} value={String(i + 1).padStart(2, '0')}>
                                                        {name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                );
                            })}
                            <button
                                onClick={handleApply}
                                disabled={!draftFrom || !draftTo}
                                className="mt-1 ml-auto rounded-lg border-none bg-primary px-4 py-1.5 text-[13px] font-medium text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                적용
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const History = () => {
    const [search, setSearch] = useState<string>('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortAsc, setSortAsc] = useState<boolean>(false);
    const [showReport, setShowReport] = useState(false);
    const [levelFilter, setLevelFilter] = useState<string>('all');
    const [originFilter, setOriginFilter] = useState<string>('all');
    const [datePreset, setDatePreset] = useState<DatePreset>('all');
    const [fromYM, setFromYM] = useState<string>('');
    const [toYM, setToYM] = useState<string>('');
    const [page, setPage] = useState<number>(1);
    const PAGE_SIZE = 10;

    const user = useAuthStore((s) => s.user);
    const { data: profile } = useProfile(user?.id ?? '');

    // --- Server-side paginated query for table data ---
    const {
        data: paginatedResult,
        isLoading,
        isError,
    } = useRoastSessionsPaginated({
        userId: user?.id ?? '',
        status: 'completed',
        page: Math.min(page, Math.max(1, Math.ceil(page))),
        pageSize: PAGE_SIZE,
        sortKey: sortKey === 'bean' ? 'date' : sortKey, // bean sorting happens client-side
        sortAsc,
        level: levelFilter === 'all' ? null : levelFilter,
        fromYM: fromYM || null,
        toYM: toYM || null,
    });

    const sessions = useMemo(() => paginatedResult?.data ?? [], [paginatedResult]);
    const filteredTotal = paginatedResult?.total ?? 0;

    // --- Client-side query for filter metadata (origins, month range) ---
    const { data: rawSessions = [] } = useRoastSessions(user?.id ?? '', 'completed');

    const uniqueOrigins = useMemo(
        () => [...new Set(rawSessions.map((s) => s.beans?.origin).filter(Boolean) as string[])].sort(),
        [rawSessions],
    );

    const monthOptions = useMemo(() => {
        const set = new Set<string>();
        const now = new Date();
        set.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
        rawSessions.forEach((s) => {
            if (s.roasted_at) {
                const d = new Date(s.roasted_at);
                set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            }
        });
        return [...set].sort();
    }, [rawSessions]);

    const totalSessions = rawSessions.length;

    const handleSort = (key: SortKey): void => {
        if (sortKey === key) {
            setSortAsc((prev) => !prev);
        } else {
            setSortKey(key);
            setSortAsc(false);
        }
        setPage(1);
    };

    const handleRowClick = (id: string): void => {
        setExpandedId(expandedId === id ? null : id);
    };

    const handleLevelFilter = (v: string) => {
        setLevelFilter(v);
        setPage(1);
    };
    const handleOriginFilter = (v: string) => {
        setOriginFilter(v);
        setPage(1);
    };
    const handlePresetChange = (p: DatePreset) => {
        setDatePreset(p);
        setPage(1);
        if (p === 'all') {
            setFromYM('');
            setToYM('');
        } else if (p !== 'custom') {
            const range = getPresetYMRange(p);
            if (range) {
                setFromYM(range.fromYM);
                setToYM(range.toYM);
            }
        }
    };
    const handleFromYM = (v: string) => {
        setFromYM(v);
        setPage(1);
    };
    const handleToYM = (v: string) => {
        setToYM(v);
        setPage(1);
    };
    const handleSearch = (v: string) => {
        setSearch(v);
        setPage(1);
    };

    // Client-side search + origin filter (can't be done server-side on joined table)
    const filteredForDisplay = useMemo((): RoastSessionWithRelations[] => {
        if (!search && originFilter === 'all') return sessions;
        const q = search.toLowerCase();
        return sessions.filter((s) => {
            if (
                q &&
                !(
                    (s.beans?.name ?? '').toLowerCase().includes(q) ||
                    (s.roast_profiles?.name ?? '').toLowerCase().includes(q) ||
                    (s.beans?.origin ?? '').toLowerCase().includes(q)
                )
            )
                return false;
            if (originFilter !== 'all' && s.beans?.origin !== originFilter) return false;
            return true;
        });
    }, [sessions, search, originFilter]);

    // Sort 'bean' column client-side since the server sorts by date as fallback
    const displaySessions = useMemo((): RoastSessionWithRelations[] => {
        if (sortKey !== 'bean') return filteredForDisplay;
        const dir = sortAsc ? 1 : -1;
        return [...filteredForDisplay].sort((a, b) => dir * (a.beans?.name ?? '').localeCompare(b.beans?.name ?? ''));
    }, [filteredForDisplay, sortKey, sortAsc]);

    // Compute effective total for "X–Y of Z" display
    // When search or origin filter is active, we need the real count from rawSessions
    const displayTotal = useMemo(() => {
        if (!search && originFilter === 'all') return filteredTotal;

        const q = search.toLowerCase();
        const filtered = rawSessions.filter((s) => {
            // Level filter
            if (levelFilter !== 'all' && s.roast_level !== levelFilter) return false;
            // Date range filter
            if (fromYM || toYM) {
                if (!s.roasted_at) return false;
                const d = new Date(s.roasted_at);
                const sessionYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (fromYM && sessionYM < fromYM) return false;
                if (toYM && sessionYM > toYM) return false;
            }
            // Search filter
            if (
                q &&
                !(
                    (s.beans?.name ?? '').toLowerCase().includes(q) ||
                    (s.roast_profiles?.name ?? '').toLowerCase().includes(q) ||
                    (s.beans?.origin ?? '').toLowerCase().includes(q)
                )
            )
                return false;
            // Origin filter
            if (originFilter !== 'all' && s.beans?.origin !== originFilter) return false;
            return true;
        });
        return filtered.length;
    }, [search, originFilter, filteredTotal, rawSessions, levelFilter, fromYM, toYM]);

    const totalPages = Math.max(1, Math.ceil(displayTotal / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);

    const reportData = useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const workerName = profile?.display_name || user?.email || '';

        const monthSessions = rawSessions.filter((s) => {
            if (!s.roasted_at) return false;
            const d = new Date(s.roasted_at);
            return d.getFullYear() === year && d.getMonth() + 1 === month;
        });

        const sessions = monthSessions.map((s) => {
            const outputKg = (s.weight_grams ?? 0) / 1000;
            const inputKg = outputKg / 0.82;
            const lossRate = inputKg > 0 ? ((inputKg - outputKg) / inputKg) * 100 : 0;
            return {
                date: s.roasted_at ? s.roasted_at.slice(0, 10) : '',
                beanLot: s.beans?.name ?? '—',
                inputKg: Math.round(inputKg * 1000) / 1000,
                outputKg: Math.round(outputKg * 1000) / 1000,
                lossRate: Math.round(lossRate * 10) / 10,
                profile: s.roast_profiles?.name ?? '—',
                worker: workerName,
            };
        });

        const totalInputKg = sessions.reduce((sum, s) => sum + s.inputKg, 0);
        const totalOutputKg = sessions.reduce((sum, s) => sum + s.outputKg, 0);
        const avgLossRate = totalInputKg > 0 ? ((totalInputKg - totalOutputKg) / totalInputKg) * 100 : 0;

        return {
            year,
            month,
            businessName: 'First Crack',
            ownerName: 'Admin',
            totalRoasts: sessions.length,
            totalInputKg: Math.round(totalInputKg * 1000) / 1000,
            totalOutputKg: Math.round(totalOutputKg * 1000) / 1000,
            avgLossRate: Math.round(avgLossRate * 10) / 10,
            sessions,
        };
    }, [rawSessions, profile, user]);

    const renderContent = (): ReactNode => {
        if (isError) {
            return (
                <div className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted">
                    Failed to load sessions. Please try again.
                </div>
            );
        }
        if (isLoading) {
            return <div className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted">Loading…</div>;
        }
        return (
            <HistoryTable
                sessions={displaySessions}
                total={totalSessions}
                filteredTotal={displayTotal}
                expandedId={expandedId}
                onRowClick={handleRowClick}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={handleSort}
                page={safePage}
                totalPages={totalPages}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
            />
        );
    };

    const handleOpenReport = useCallback(() => setShowReport(true), []);
    const handleCloseReport = useCallback(() => setShowReport(false), []);

    const handleExportCsv = useCallback(async () => {
        try {
            const q = search.toLowerCase();
            const filtered = rawSessions.filter((s) => {
                if (levelFilter !== 'all' && s.roast_level !== levelFilter) return false;
                if (fromYM || toYM) {
                    if (!s.roasted_at) return false;
                    const d = new Date(s.roasted_at);
                    const sessionYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    if (fromYM && sessionYM < fromYM) return false;
                    if (toYM && sessionYM > toYM) return false;
                }
                if (
                    q &&
                    !(
                        (s.beans?.name ?? '').toLowerCase().includes(q) ||
                        (s.roast_profiles?.name ?? '').toLowerCase().includes(q) ||
                        (s.beans?.origin ?? '').toLowerCase().includes(q)
                    )
                )
                    return false;
                if (originFilter !== 'all' && s.beans?.origin !== originFilter) return false;
                return true;
            });

            if (filtered.length === 0) {
                await message('No sessions to export.', { title: 'First Crack', kind: 'info' });
                return;
            }

            const today = new Date().toISOString().slice(0, 10);
            const filename = `roast-history-${today}.csv`;
            const dir = await downloadDir();
            const path = `${dir}${filename}`;

            const confirmed = await confirm(`Save to: ${path}\nExport ${filtered.length} session(s) as CSV?`, {
                title: 'First Crack',
                kind: 'info',
                okLabel: 'Export',
                cancelLabel: 'Cancel',
            });
            if (!confirmed) return;

            const csv = sessionsToCsv(filtered);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export CSV failed:', err);
        }
    }, [rawSessions, search, levelFilter, fromYM, toYM, originFilter]);

    return (
        <PageLayout>
            <PageHeader
                title="Roast History"
                subtitle={isLoading ? 'Loading…' : `${totalSessions} sessions recorded`}
                className="flex-col gap-4 md:flex-row"
                actions={
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleOpenReport}
                            className="inline-flex items-center gap-1.5 self-start rounded-full border-0 dark:border-white bg-main-bg dark:bg-[#1a1a1a] px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary transition hover:-translate-y-px hover:text-primary"
                        >
                            <FileText size={14} strokeWidth={2} />
                            월간 보고서
                        </button>
                        <button
                            type="button"
                            onClick={handleExportCsv}
                            className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full border-0 dark:border-white bg-main-bg dark:bg-[#1a1a1a] px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary transition hover:-translate-y-px hover:text-primary"
                        >
                            <Download size={14} strokeWidth={2} />
                            Export CSV
                        </button>
                    </div>
                }
            />

            <div className="mb-4 flex flex-col gap-3 rounded-lg bg-main-bg p-4 lg:flex-row lg:items-center lg:gap-3 lg:px-5">
                <div className="flex flex-1 items-center gap-2 rounded-lg bg-surface px-3 py-2">
                    <Search size={14} strokeWidth={2} className="text-muted" />
                    <input
                        className="w-full border-none bg-transparent text-[13px] tracking-[0.14px] text-primary outline-none placeholder:text-muted font-body"
                        value={search}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Search by bean, profile, or origin..."
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <FilterDropdown
                        label="All Levels"
                        value={levelFilter}
                        options={ROAST_LEVELS.filter((l) => rawSessions.some((s) => s.roast_level === l))}
                        onSelect={handleLevelFilter}
                    />
                    <FilterDropdown
                        label="All Origins"
                        value={originFilter}
                        options={uniqueOrigins}
                        onSelect={handleOriginFilter}
                    />
                    <DateRangeFilter
                        preset={datePreset}
                        fromYM={fromYM}
                        toYM={toYM}
                        monthOptions={monthOptions}
                        onPresetChange={handlePresetChange}
                        onFromYM={handleFromYM}
                        onToYM={handleToYM}
                    />
                </div>
            </div>

            {renderContent()}
            {showReport && (
                <ModalShell onClose={handleCloseReport} labelledBy="monthly-report-title">
                    <div className="relative max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
                        <button
                            onClick={handleCloseReport}
                            className="fixed top-6 right-6 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 shadow-md backdrop-blur-sm hover:bg-white"
                        >
                            <X size={16} strokeWidth={2} />
                        </button>
                        <MonthlyProductionReport {...reportData} />
                    </div>
                </ModalShell>
            )}
        </PageLayout>
    );
};
