import { useProfile } from '@entities/profile';
import { useDeleteRoastSession, useRoastSessions, useRoastSessionsPaginated } from '@entities/roast';
import { useExportCsv } from '@features/export-csv';
import { buildReportData } from '@shared/lib/buildReportData';
import { formatDateShort } from '@shared/lib/format';
import { filterSessions, paginateSessions, type SessionFilterCriteria, sortSessions } from '@shared/lib/sessionFilter';
import { useAuthStore } from '@shared/store/auth';
import { FilterDropdown } from '@shared/ui/FilterDropdown';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { MonthlyProductionReport } from '@views/reports/MonthlyProductionReport';
import type { DatePreset } from '@widgets/date-range-filter';
import { DateRangeFilter, getPresetYMRange } from '@widgets/date-range-filter';
import { Download, FileText, Search, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DeleteSessionModal } from './ui/DeleteSessionModal';
import type { SortKey } from './ui/HistoryTable';
import { HistoryTable } from './ui/HistoryTable';

const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

const PAGE_SIZE = 10;

export const History = () => {
    const { t } = useTranslation();
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
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const user = useAuthStore((s) => s.user);
    const { data: profile } = useProfile(user?.id ?? '');

    const useClientPagination = search.length > 0 || originFilter !== 'all';

    const filterCriteria: SessionFilterCriteria = useMemo(
        () => ({ search, levelFilter, fromYM, toYM, originFilter }),
        [search, levelFilter, fromYM, toYM, originFilter],
    );

    const {
        data: paginatedResult,
        isLoading: isPaginatedLoading,
        isError: isPaginatedError,
    } = useRoastSessionsPaginated({
        userId: user?.id ?? '',
        status: 'completed',
        page: Math.max(1, page),
        pageSize: PAGE_SIZE,
        sortKey: sortKey === 'bean' ? 'date' : sortKey,
        sortAsc,
        level: levelFilter === 'all' ? null : levelFilter,
        fromYM: fromYM || null,
        toYM: toYM || null,
        enabled: !useClientPagination,
    });

    const {
        data: rawSessions = [],
        isLoading: isRawLoading,
        isError: isRawError,
    } = useRoastSessions(user?.id ?? '', 'completed');

    const totalSessions = rawSessions.length;

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

    const clientFiltered = useMemo(
        () => (useClientPagination ? filterSessions(rawSessions, filterCriteria) : []),
        [useClientPagination, rawSessions, filterCriteria],
    );

    const clientSorted = useMemo(
        () => (useClientPagination ? sortSessions(clientFiltered, sortKey, sortAsc) : []),
        [useClientPagination, clientFiltered, sortKey, sortAsc],
    );

    const displayTotal = useClientPagination ? clientFiltered.length : (paginatedResult?.total ?? 0);

    const totalPages = Math.max(1, Math.ceil(displayTotal / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);

    const displaySessions = useMemo(() => {
        if (useClientPagination) {
            return paginateSessions(clientSorted, safePage, PAGE_SIZE);
        }
        const sessions = paginatedResult?.data ?? [];
        if (sortKey === 'bean') {
            return sortSessions(sessions, 'bean', sortAsc);
        }
        return sessions;
    }, [useClientPagination, clientSorted, safePage, paginatedResult, sortKey, sortAsc]);

    const isLoading = useClientPagination ? isRawLoading : isPaginatedLoading;
    const isError = useClientPagination ? isRawError : isPaginatedError;

    const reportData = useMemo(
        () => buildReportData(rawSessions, profile?.display_name, user?.email),
        [rawSessions, profile, user],
    );

    const exportCsv = useExportCsv();
    const deleteSession = useDeleteRoastSession(user?.id ?? '');

    const deletingSession = useMemo(
        () => rawSessions.find((s) => s.id === deletingId) ?? null,
        [rawSessions, deletingId],
    );

    // ── Handlers ──

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

    const resetPage = useCallback(() => setPage(1), []);

    const handleLevelFilter = (v: string) => {
        setLevelFilter(v);
        resetPage();
    };
    const handleOriginFilter = (v: string) => {
        setOriginFilter(v);
        resetPage();
    };
    const handlePresetChange = (p: DatePreset) => {
        setDatePreset(p);
        resetPage();
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
        resetPage();
    };
    const handleToYM = (v: string) => {
        setToYM(v);
        resetPage();
    };
    const handleSearch = (v: string) => {
        setSearch(v);
        resetPage();
    };

    const handleOpenReport = useCallback(() => setShowReport(true), []);
    const handleCloseReport = useCallback(() => setShowReport(false), []);

    const handleExportCsv = useCallback(() => {
        const filtered = filterSessions(rawSessions, filterCriteria);
        void exportCsv(filtered);
    }, [rawSessions, filterCriteria, exportCsv]);

    const handleDeleteClick = useCallback((id: string) => setDeletingId(id), []);
    const handleCloseDelete = useCallback(() => setDeletingId(null), []);
    const handleConfirmDelete = useCallback(() => {
        if (!deletingId) return;
        deleteSession.mutate(deletingId, {
            onSuccess: () => {
                setDeletingId(null);
                setExpandedId((prev) => (prev === deletingId ? null : prev));
            },
        });
    }, [deletingId, deleteSession]);

    const renderContent = (): React.ReactNode => {
        if (isError) {
            return <div className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted">{t('history.error')}</div>;
        }
        if (isLoading) {
            return (
                <div className="rounded-lg bg-main-bg p-8 text-center text-sm text-muted">{t('history.loading')}</div>
            );
        }
        return (
            <HistoryTable
                sessions={displaySessions}
                total={totalSessions}
                filteredTotal={displayTotal}
                expandedId={expandedId}
                onRowClick={handleRowClick}
                onDeleteClick={handleDeleteClick}
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

    return (
        <PageLayout>
            <PageHeader
                title={t('history.title')}
                subtitle={isLoading ? t('history.subtitleLoading') : t('history.subtitle', { count: totalSessions })}
                className="flex-col gap-4 md:flex-row"
                actions={
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleOpenReport}
                            className="inline-flex items-center gap-1.5 self-start rounded-full border border-transparent dark:border-[#585d61] bg-main-bg dark:bg-[#181d21] px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary transition hover:-translate-y-px hover:text-primary"
                        >
                            <FileText size={14} strokeWidth={2} />
                            {t('history.monthlyReport')}
                        </button>
                        <button
                            type="button"
                            onClick={handleExportCsv}
                            className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full border border-transparent dark:border-[#585d61] bg-main-bg dark:bg-[#181d21] px-4 py-2.25 text-[13px] font-medium tracking-[0.14px] text-secondary transition hover:-translate-y-px hover:text-primary"
                        >
                            <Download size={14} strokeWidth={2} />
                            {t('history.exportCsv')}
                        </button>
                    </div>
                }
            />

            <div className="mb-4 flex flex-col gap-3 rounded-lg bg-main-bg dark:border dark:border-[#585d61] p-4 lg:flex-row lg:items-center lg:gap-3 lg:px-5">
                <div className="flex flex-1 items-center gap-2 rounded-lg bg-surface dark:bg-surface-elevated px-3 py-2">
                    <Search size={14} strokeWidth={2} className="text-muted" />
                    <input
                        className="w-full border-none bg-transparent text-[13px] tracking-[0.14px] text-primary outline-none placeholder:text-muted font-body"
                        value={search}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder={t('history.searchPlaceholder')}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <FilterDropdown
                        label={t('history.allLevels')}
                        value={levelFilter}
                        options={ROAST_LEVELS.filter((l) => rawSessions.some((s) => s.roast_level === l))}
                        onSelect={handleLevelFilter}
                    />
                    <FilterDropdown
                        label={t('history.allOrigins')}
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
            <DeleteSessionModal
                open={deletingId !== null}
                sessionName={
                    deletingSession
                        ? `${deletingSession.beans?.name ?? ''} (${formatDateShort(deletingSession.roasted_at)})`.trim()
                        : ''
                }
                isLoading={deleteSession.isPending}
                onClose={handleCloseDelete}
                onConfirm={handleConfirmDelete}
            />
        </PageLayout>
    );
};
