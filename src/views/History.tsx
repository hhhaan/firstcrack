import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Search, Filter, ChevronDown, ChevronUp, Download } from 'lucide-react';

const sessions = [
    {
        id: 1,
        date: '2026-04-14',
        bean: 'Ethiopia Yirgacheffe',
        origin: 'Ethiopia',
        process: 'Natural',
        profile: 'Signature Light',
        weightIn: 250,
        weightOut: 213,
        duration: '12:34',
        charge: 200,
        drop: 196,
        level: 'Light',
        dev: '1:42',
        loss: '14.8%',
        notes: 'Clean and floral. Slight under-development.',
    },
    {
        id: 2,
        date: '2026-04-12',
        bean: 'Colombia Huila',
        origin: 'Colombia',
        process: 'Washed',
        profile: 'Balanced Medium',
        weightIn: 500,
        weightOut: 421,
        duration: '13:10',
        charge: 200,
        drop: 203,
        level: 'Medium-Light',
        dev: '1:55',
        loss: '15.8%',
        notes: 'Caramel and stone fruit. Good development.',
    },
    {
        id: 3,
        date: '2026-04-10',
        bean: 'Brazil Cerrado',
        origin: 'Brazil',
        process: 'Natural',
        profile: 'House Medium',
        weightIn: 1000,
        weightOut: 840,
        duration: '14:20',
        charge: 195,
        drop: 211,
        level: 'Medium',
        dev: '2:10',
        loss: '16.0%',
        notes: 'Nutty and chocolatey. Consistent batch.',
    },
    {
        id: 4,
        date: '2026-04-08',
        bean: 'Kenya AA',
        origin: 'Kenya',
        process: 'Washed',
        profile: 'Signature Light',
        weightIn: 250,
        weightOut: 211,
        duration: '11:55',
        charge: 200,
        drop: 193,
        level: 'Light',
        dev: '1:35',
        loss: '15.6%',
        notes: 'Bright citrus. Slightly high ROR peak.',
    },
    {
        id: 5,
        date: '2026-04-06',
        bean: 'Guatemala Antigua',
        origin: 'Guatemala',
        process: 'Honey',
        profile: 'House Medium',
        weightIn: 500,
        weightOut: 419,
        duration: '13:45',
        charge: 198,
        drop: 208,
        level: 'Medium',
        dev: '2:05',
        loss: '16.2%',
        notes: 'Sweet and balanced. Best batch so far.',
    },
    {
        id: 6,
        date: '2026-04-03',
        bean: 'Panama Gesha',
        origin: 'Panama',
        process: 'Natural',
        profile: 'Signature Light',
        weightIn: 200,
        weightOut: 170,
        duration: '12:15',
        charge: 198,
        drop: 194,
        level: 'Light',
        dev: '1:50',
        loss: '15.0%',
        notes: 'Jasmine and peach. Exceptional lot.',
    },
    {
        id: 7,
        date: '2026-03-31',
        bean: 'Ethiopia Yirgacheffe',
        origin: 'Ethiopia',
        process: 'Natural',
        profile: 'Signature Light',
        weightIn: 250,
        weightOut: 212,
        duration: '12:22',
        charge: 200,
        drop: 195,
        level: 'Light',
        dev: '1:45',
        loss: '15.2%',
        notes: '',
    },
    {
        id: 8,
        date: '2026-03-28',
        bean: 'Colombia Huila',
        origin: 'Colombia',
        process: 'Washed',
        profile: 'Balanced Medium',
        weightIn: 1000,
        weightOut: 843,
        duration: '13:05',
        charge: 200,
        drop: 202,
        level: 'Medium-Light',
        dev: '1:52',
        loss: '15.7%',
        notes: 'Consistent result.',
    },
];

type Session = (typeof sessions)[0];

const levelColor: Record<string, string> = {
    Light: '#a16207',
    'Medium-Light': '#92400e',
    Medium: '#7c2d12',
};

const levelBg: Record<string, string> = {
    Light: 'rgba(254,243,199,0.8)',
    'Medium-Light': 'rgba(254,231,200,0.8)',
    Medium: 'rgba(253,220,198,0.8)',
};

type SortKey = 'date' | 'bean' | 'duration' | 'drop' | 'level';

type Column = {
    key: SortKey | null;
    label: string;
    width: string;
    sortable: boolean;
    render: (session: Session) => ReactNode;
};

const columns: Column[] = [
    { key: 'date', label: 'Date', width: '80px', sortable: true, render: (s) => s.date.slice(5) },
    { key: 'bean', label: 'Bean', width: '200px', sortable: true, render: (s) => s.bean },
    { key: null, label: 'Profile', width: '150px', sortable: false, render: (s) => s.profile },
    { key: null, label: 'Weight', width: '120px', sortable: false, render: (s) => `${s.weightIn}g → ${s.weightOut}g` },
    { key: 'drop', label: 'Drop', width: '80px', sortable: true, render: (s) => `${s.drop}°C` },
    { key: 'duration', label: 'Duration', width: '90px', sortable: true, render: (s) => s.duration },
    { key: null, label: 'Dev', width: '70px', sortable: false, render: (s) => s.dev },
    { key: null, label: 'Loss', width: '70px', sortable: false, render: (s) => s.loss },
    {
        key: 'level',
        label: 'Level',
        width: '90px',
        sortable: true,
        render: (s) => (
            <span
                className="text-[11px] font-medium px-2 py-0.75 rounded-full whitespace-nowrap tracking-[0.14px]"
                style={{
                    color: levelColor[s.level] || 'var(--color-muted)',
                    background: levelBg[s.level] || 'var(--color-surface)',
                }}
            >
                {s.level}
            </span>
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

const ExpandedRow = ({ session }: { session: Session }): ReactNode => {
    const devMinutes = parseInt(session.dev.split(':')[0]) + parseInt(session.dev.split(':')[1]) / 60;
    const totalMinutes = parseInt(session.duration.split(':')[0]) + parseInt(session.duration.split(':')[1]) / 60;
    const devPercent = ((devMinutes / totalMinutes) * 100).toFixed(1);

    return (
        <tr className="border-b border-border-subtle bg-[rgba(245,242,239,0.3)]">
            <td colSpan={columns.length} className="px-4 py-4 md:px-6">
                <div className="grid items-start gap-4 md:grid-cols-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_2fr]">
                    {[
                        { label: 'Origin', value: session.origin },
                        { label: 'Process', value: session.process },
                        { label: 'Charge Temp', value: `${session.charge}°C` },
                        { label: 'Development %', value: `${devPercent}%` },
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
};

const HistoryTable = ({
    filtered,
    expandedId,
    onRowClick,
    sortKey,
    sortAsc,
    onSort,
}: {
    filtered: Session[];
    expandedId: number | null;
    onRowClick: (id: number) => void;
    sortKey: SortKey;
    sortAsc: boolean;
    onSort: (key: SortKey) => void;
}): ReactNode => {
    return (
        <div className="overflow-x-auto rounded-2xl bg-main-bg shadow-ring [-webkit-overflow-scrolling:touch]">
            <table className="min-w-250 w-full table-fixed border-collapse md:min-w-200 lg:min-w-250">
                <thead>
                    <tr className="border-b border-border-subtle">
                        {columns.map((col) => {
                            const responsiveClass =
                                col.label === 'Profile' || col.label === 'Dev' || col.label === 'Loss'
                                    ? 'md:hidden lg:table-cell'
                                    : '';

                            return (
                                <th
                                    key={col.label}
                                    onClick={() => col.sortable && col.key && onSort(col.key as SortKey)}
                                    className={`px-3 py-3 text-left text-[11px] font-medium uppercase tracking-[0.5px] text-muted select-none whitespace-nowrap ${responsiveClass} ${
                                        col.sortable ? 'cursor-pointer' : 'cursor-default'
                                    }`}
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
                    {filtered.map((session) => {
                        const isExpanded = expandedId === session.id;

                        return (
                            <Fragment key={session.id}>
                                <tr
                                    onClick={() => onRowClick(session.id)}
                                    className={`cursor-pointer border-b border-border-subtle transition ${
                                        isExpanded ? 'bg-[rgba(245,245,245,0.5)]' : 'hover:bg-[rgba(245,242,239,0.45)]'
                                    }`}
                                >
                                    {columns.map((col, idx) => {
                                        const cellClass =
                                            col.key === 'date'
                                                ? 'font-mono text-muted'
                                                : col.key === 'bean'
                                                  ? 'font-medium tracking-[0.14px] text-primary'
                                                  : 'tracking-[0.14px] text-secondary';

                                        const responsiveClass =
                                            col.label === 'Profile' || col.label === 'Dev' || col.label === 'Loss'
                                                ? 'md:hidden lg:table-cell'
                                                : '';

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
                    Showing {filtered.length} of {sessions.length} sessions
                </span>
                <div className="flex gap-1.5">
                    {[1, 2, 3].map((p) => (
                        <button
                            key={p}
                            className={`h-7 w-7 rounded-md border-0 text-xs font-medium transition ${
                                p === 1
                                    ? 'bg-primary text-white shadow-none'
                                    : 'bg-surface text-secondary shadow-inset hover:bg-surface-warm-solid'
                            }`}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default function History() {
    const [search, setSearch] = useState<string>('');
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortAsc, setSortAsc] = useState<boolean>(false);

    const handleSort = (key: SortKey): void => {
        if (sortKey === key) {
            setSortAsc((prev) => !prev);
        } else {
            setSortKey(key);
            setSortAsc(false);
        }
    };

    const handleRowClick = (id: number): void => {
        setExpandedId(expandedId === id ? null : id);
    };

    const filtered = useMemo((): Session[] => {
        return sessions
            .filter(
                (s): boolean =>
                    s.bean.toLowerCase().includes(search.toLowerCase()) ||
                    s.profile.toLowerCase().includes(search.toLowerCase()) ||
                    s.origin.toLowerCase().includes(search.toLowerCase()),
            )
            .sort((a, b): number => {
                const dir = sortAsc ? 1 : -1;
                if (sortKey === 'date') return dir * (a.date < b.date ? -1 : 1);
                if (sortKey === 'bean') return dir * a.bean.localeCompare(b.bean);
                if (sortKey === 'duration') return dir * (a.duration < b.duration ? -1 : 1);
                if (sortKey === 'drop') return dir * (a.drop - b.drop);
                return dir * a.level.localeCompare(b.level);
            });
    }, [search, sortKey, sortAsc]);

    return (
        <div className="mx-auto max-w-7xl py-8 px-10 md:py-6 md:px-8 lg:py-8 lg:px-10">
            <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="mb-1 text-[32px] font-light leading-[1.13] tracking-[-0.4px] text-primary font-display">
                        Roast History
                    </h1>
                    <p className="text-sm tracking-[0.14px] text-muted">{sessions.length} sessions recorded</p>
                </div>
                <button className="inline-flex items-center gap-1.5 self-start rounded-full border-0 bg-main-bg px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary shadow-card transition hover:-translate-y-px hover:text-primary">
                    <Download size={14} strokeWidth={2} />
                    Export CSV
                </button>
            </div>

            <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-main-bg p-4 shadow-ring lg:flex-row lg:items-center lg:gap-3 lg:px-5">
                <div className="flex flex-1 items-center gap-2 rounded-2xl bg-surface px-3 py-2 shadow-inset">
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
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-2xl border-0 bg-surface px-3 py-2 text-[13px] font-medium tracking-[0.14px] text-secondary shadow-(--shadow-inset) transition hover:bg-surface-warm-solid hover:text-primary"
                        >
                            <Filter size={12} strokeWidth={2} className="text-muted" />
                            {label}
                            <ChevronDown size={11} strokeWidth={2} className="text-muted" />
                        </button>
                    ))}
                </div>
            </div>

            <HistoryTable
                filtered={filtered}
                expandedId={expandedId}
                onRowClick={handleRowClick}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={handleSort}
            />
        </div>
    );
}
