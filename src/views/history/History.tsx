import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Search, Filter, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { useRoastSessions } from '@entities/roast';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
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
};

const formatDuration = (seconds: number | null): string => {
    if (seconds == null) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const formatDate = (iso: string | null): string => {
    if (!iso) return '—';
    return iso.slice(5, 10); // MM-DD
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
    { key: 'date', label: 'Date', width: '80px', sortable: true, render: (s) => formatDate(s.roasted_at) },
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

const SortIcon = ({ col, sortKey, sortAsc }: { col: SortKey; sortKey: SortKey; sortAsc: boolean }): ReactNode => {
    if (sortKey !== col) {
        return <ChevronDown size={11} strokeWidth={2} color="var(--color-muted)" style={{ opacity: 0.4 }} />;
    }
    return sortAsc ? (
        <ChevronUp size={11} strokeWidth={2.5} color="var(--color-primary)" />
    ) : (
        <ChevronDown size={11} strokeWidth={2.5} color="var(--color-primary)" />
    );
};

const ExpandedRow = ({ session }: { session: RoastSessionWithRelations }): ReactNode => (
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
                        <div className="font-mono text-[13px] font-medium tracking-[0.14px] text-primary">{value}</div>
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

const HistoryTable = ({
    sessions,
    total,
    expandedId,
    onRowClick,
    sortKey,
    sortAsc,
    onSort,
}: {
    sessions: RoastSessionWithRelations[];
    total: number;
    expandedId: string | null;
    onRowClick: (id: string) => void;
    sortKey: SortKey;
    sortAsc: boolean;
    onSort: (key: SortKey) => void;
}): ReactNode => (
    <div className="overflow-x-auto rounded-lg bg-main-bg shadow-ring [-webkit-overflow-scrolling:touch]">
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
                                    const responsiveClass = col.label === 'Profile' ? 'md:hidden lg:table-cell' : '';
                                    return (
                                        <td
                                            key={col.key || idx}
                                            className={`px-3 py-3 text-[13px] whitespace-nowrap ${cellClass} ${responsiveClass}`}
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

        <div className="flex flex-col gap-3 border-t border-border-subtle px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs tracking-[0.14px] text-muted">
                Showing {sessions.length} of {total} sessions
            </span>
        </div>
    </div>
);

export const History = () => {
    const [search, setSearch] = useState<string>('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortAsc, setSortAsc] = useState<boolean>(false);

    const user = useAuthStore((s) => s.user);

    const { data: rawSessions = [], isLoading, isError } = useRoastSessions(user?.id ?? '', 'completed');

    const handleSort = (key: SortKey): void => {
        if (sortKey === key) {
            setSortAsc((prev) => !prev);
        } else {
            setSortKey(key);
            setSortAsc(false);
        }
    };

    const handleRowClick = (id: string): void => {
        setExpandedId(expandedId === id ? null : id);
    };

    const filtered = useMemo((): RoastSessionWithRelations[] => {
        const q = search.toLowerCase();
        return rawSessions
            .filter(
                (s) =>
                    (s.beans?.name ?? '').toLowerCase().includes(q) ||
                    (s.roast_profiles?.name ?? '').toLowerCase().includes(q) ||
                    (s.beans?.origin ?? '').toLowerCase().includes(q),
            )
            .sort((a, b): number => {
                const dir = sortAsc ? 1 : -1;
                if (sortKey === 'date') return dir * ((a.roasted_at ?? '') < (b.roasted_at ?? '') ? -1 : 1);
                if (sortKey === 'bean') return dir * (a.beans?.name ?? '').localeCompare(b.beans?.name ?? '');
                if (sortKey === 'duration') return dir * ((a.duration_seconds ?? 0) - (b.duration_seconds ?? 0));
                if (sortKey === 'drop') return dir * ((a.drop_temp_celsius ?? 0) - (b.drop_temp_celsius ?? 0));
                return dir * (a.roast_level ?? '').localeCompare(b.roast_level ?? '');
            });
    }, [rawSessions, search, sortKey, sortAsc]);

    return (
        <div className="mx-auto max-w-7xl py-8 px-10 md:py-6 md:px-8 lg:py-8 lg:px-10">
            <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                        Roast History
                    </h1>
                    <p className="text-sm tracking-[0.14px] text-muted">
                        {isLoading ? 'Loading…' : `${rawSessions.length} sessions recorded`}
                    </p>
                </div>
                <button className="inline-flex items-center gap-1.5 self-start rounded-full border-0 bg-main-bg px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary shadow-card transition hover:-translate-y-px hover:text-primary">
                    <Download size={14} strokeWidth={2} />
                    Export CSV
                </button>
            </div>

            <div className="mb-4 flex flex-col gap-3 rounded-lg bg-main-bg p-4 shadow-ring lg:flex-row lg:items-center lg:gap-3 lg:px-5">
                <div className="flex flex-1 items-center gap-2 rounded-lg bg-surface px-3 py-2 shadow-inset">
                    <Search size={14} strokeWidth={2} className="text-muted" />
                    <input
                        className="w-full border-none bg-transparent text-[13px] tracking-[0.14px] text-primary outline-none placeholder:text-muted font-body"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by bean, profile, or origin..."
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    {['All Levels', 'All Origins', 'This Month'].map((label) => (
                        <button
                            key={label}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border-0 bg-surface px-3 py-2 text-[13px] font-medium tracking-[0.14px] text-secondary shadow-(--shadow-inset) transition hover:bg-surface-warm-solid hover:text-primary"
                        >
                            <Filter size={12} strokeWidth={2} className="text-muted" />
                            {label}
                            <ChevronDown size={11} strokeWidth={2} className="text-muted" />
                        </button>
                    ))}
                </div>
            </div>

            {isError ? (
                <div className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted shadow-ring">
                    Failed to load sessions. Please try again.
                </div>
            ) : isLoading ? (
                <div className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted shadow-ring">Loading…</div>
            ) : filtered.length === 0 ? (
                <div className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted shadow-ring">
                    No sessions found.
                </div>
            ) : (
                <HistoryTable
                    sessions={filtered}
                    total={rawSessions.length}
                    expandedId={expandedId}
                    onRowClick={handleRowClick}
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={handleSort}
                />
            )}
        </div>
    );
};
