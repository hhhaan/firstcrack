import { useActiveWorkspace } from '@entities/organization';
import {
    useDeleteRoastSession,
    useRoastSessionFilterMeta,
    useRoastSessions,
    useRoastSessionsPaginated,
} from '@entities/roast';
import { useCreateRoastProfile, useSetProfileReference } from '@entities/roast-profile';
import { useExportCsv } from '@features/export-csv';
import { COMPARE_COLORS } from '@shared/lib/compare-style';
import { formatDateTimeShort } from '@shared/lib/format';
import { filterSessions, filterSessionsByDateRange, paginateSessions, sortSessions } from '@shared/lib/sessionFilter';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { useToastStore } from '@shared/store/toast';
import type { RoastProfile } from '@shared/types/database.types';
import { FilterDropdown } from '@shared/ui/FilterDropdown';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { DateRangeFilter } from '@widgets/date-range-filter';
import { NewProfileModal } from '@widgets/new-profile-modal';
import { Download, GitCompare, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistoryFilters } from './hooks/useHistoryFilters';
import { DeleteSessionModal } from './ui/DeleteSessionModal';
import { ExportCsvModal, type ExportDateRange } from './ui/ExportCsvModal';
import { HistorySessionDetail } from './ui/HistorySessionDetail';
import { HistorySkeleton } from './ui/HistorySkeleton';
import { HistoryTable } from './ui/HistoryTable';
import { SessionCompareModal } from './ui/SessionCompareModal';

const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

const PAGE_SIZE = 10;

const findById = <T extends { id: string }>(id: string | null, ...lists: T[][]): T | null => {
    if (!id) return null;
    for (const list of lists) {
        const found = list.find((item) => item.id === id);
        if (found) return found;
    }
    return null;
};

export type HistoryFocus = { sessionId: string; profileId: string };

export const History = ({ focus = null }: { focus?: HistoryFocus | null }) => {
    const { t } = useTranslation();
    const [selectedId, setSelectedId] = useState<string | null>(focus?.sessionId ?? null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [compareMode, setCompareMode] = useState(false);
    const [compareIds, setCompareIds] = useState<string[]>([]);
    const [showCompare, setShowCompare] = useState(false);
    const [promoteSessionId, setPromoteSessionId] = useState<string | null>(null);

    const {
        search,
        levelFilter,
        originFilter,
        profileFilter,
        datePreset,
        fromYM,
        toYM,
        page,
        sortKey,
        sortAsc,
        filterCriteria,
        setSearch,
        setLevelFilter,
        setOriginFilter,
        setProfileFilter,
        setDatePreset,
        setFromYM,
        setToYM,
        setSort,
        setPage,
    } = useHistoryFilters();

    const { workspaceOwnerId } = useActiveWorkspace();

    const useClientPagination =
        search.length > 0 ||
        originFilter !== 'all' ||
        profileFilter !== 'all' ||
        sortKey === 'duration' ||
        sortKey === 'bean';
    const [exportOpen, setExportOpen] = useState(false);
    // 전체 목록이 아직 없을 때의 export 요청 — 목록이 도착하면 effect가 집어간다
    const [pendingExportRange, setPendingExportRange] = useState<ExportDateRange | null>(null);
    // Full list when client search/filter, duration sort (Drop-first, not duration_seconds),
    // bean sort (display name is a join, not a session column), compare, or export.
    const needFullList = useClientPagination || compareMode || pendingExportRange !== null || focus != null;

    const {
        data: paginatedResult,
        isLoading: isPaginatedLoading,
        isError: isPaginatedError,
    } = useRoastSessionsPaginated({
        userId: workspaceOwnerId,
        status: 'completed',
        page: Math.max(1, page),
        pageSize: PAGE_SIZE,
        sortKey,
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
    } = useRoastSessions(workspaceOwnerId, 'completed', { enabled: needFullList });

    const { data: filterMeta = [] } = useRoastSessionFilterMeta(workspaceOwnerId);

    const totalSessions = filterMeta.length;

    const uniqueOrigins = useMemo(
        () =>
            [...new Set(filterMeta.map((s) => s.beans?.origin).filter(Boolean) as string[])].sort((a, b) =>
                a.localeCompare(b),
            ),
        [filterMeta],
    );

    const profileOptions = useMemo(() => {
        const profiles = new Map<string, string>();
        for (const session of filterMeta) {
            if (session.profile_id && session.roast_profiles) {
                profiles.set(session.profile_id, session.roast_profiles.name);
            }
        }
        return new Map([...profiles].sort((a, b) => a[1].localeCompare(b[1])));
    }, [filterMeta]);

    const monthOptions = useMemo(() => {
        const set = new Set<string>();
        const now = new Date();
        set.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
        for (const s of filterMeta) {
            if (s.roasted_at) {
                const d = new Date(s.roasted_at);
                set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            }
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [filterMeta]);

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
        return paginatedResult?.data ?? [];
    }, [useClientPagination, clientSorted, safePage, paginatedResult]);

    const isLoading = useClientPagination ? isRawLoading : isPaginatedLoading;
    const isError = useClientPagination ? isRawError : isPaginatedError;

    const selectedSession = useMemo(
        () => (selectedId && !compareMode ? findById(selectedId, displaySessions, rawSessions) : null),
        [selectedId, compareMode, displaySessions, rawSessions],
    );

    const exportCsv = useExportCsv();
    const deleteSession = useDeleteRoastSession(workspaceOwnerId);
    const { mutateAsync: createProfile } = useCreateRoastProfile(workspaceOwnerId);
    const { mutateAsync: setReference, isPending: settingReference } = useSetProfileReference(workspaceOwnerId);

    const handleProfileCreated = useCallback(
        async (profileData: RoastProfile) => {
            const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...insert } = profileData;
            void _id;
            void _createdAt;
            void _updatedAt;
            await createProfile(insert);
        },
        [createProfile],
    );

    const deletingSession = findById(deletingId, displaySessions, rawSessions);

    // ── Handlers ──

    const handleRowClick = (id: string): void => {
        if (compareMode) {
            setCompareIds((prev) =>
                prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : prev.length >= COMPARE_COLORS.length
                      ? prev
                      : [...prev, id],
            );
            return;
        }
        setSelectedId(id);
    };

    const handleToggleCompareMode = useCallback(() => {
        if (compareMode) {
            setCompareMode(false);
            setCompareIds([]);
            return;
        }
        setCompareMode(true);
        setCompareIds(selectedId ? [selectedId] : []);
        setSelectedId(null);
    }, [compareMode, selectedId]);

    const compareSessions = useMemo(
        () => compareIds.map((id) => findById(id, rawSessions, displaySessions)).filter((session) => session != null),
        [compareIds, rawSessions, displaySessions],
    );

    const runExport = useCallback(
        (range: ExportDateRange) => {
            // Option B: export range is independent of list search/level/origin/date filters.
            const filtered = filterSessionsByDateRange(rawSessions, range.fromYM, range.toYM);
            void exportCsv(filtered);
        },
        [rawSessions, exportCsv],
    );

    const handleExportConfirm = useCallback(
        (range: ExportDateRange) => {
            setExportOpen(false);
            if (rawSessions.length === 0) {
                setPendingExportRange(range);
                return;
            }
            runExport(range);
        },
        [rawSessions.length, runExport],
    );

    useEffect(() => {
        if (isRawLoading || !pendingExportRange) return;
        runExport(pendingExportRange);
        setPendingExportRange(null);
    }, [isRawLoading, pendingExportRange, runExport]);

    const handleDeleteClick = useCallback((id: string) => setDeletingId(id), []);
    const resetDelete = deleteSession.reset;
    const handleCloseDelete = useCallback(() => {
        setDeletingId(null);
        resetDelete();
    }, [resetDelete]);
    // 23503 = FK violation: a profile still points at this session (RESTRICT, #352)
    const deleteError = deleteSession.error
        ? (deleteSession.error as { code?: string }).code === '23503'
            ? t('history.delete.blockedByProfile')
            : t('history.delete.failed')
        : null;
    const handleConfirmDelete = useCallback(() => {
        if (!deletingId) return;
        const id = deletingId;
        setDeletingId(null);
        setSelectedId((prev) => (prev === id ? null : prev));
        deleteSession.mutate(id, {
            onError: () => setDeletingId((current) => current ?? id),
        });
    }, [deletingId, deleteSession]);

    const renderContent = (): React.ReactNode => {
        if (isError) {
            return (
                <div className="rounded-2xl border border-border bg-main-bg p-8 text-center text-sm text-muted">
                    {t('history.error')}
                </div>
            );
        }
        if (isLoading) {
            return <HistorySkeleton />;
        }
        return (
            <HistoryTable
                sessions={displaySessions}
                total={totalSessions}
                filteredTotal={displayTotal}
                compareMode={compareMode}
                compareIds={compareIds}
                onRowClick={handleRowClick}
                onDeleteClick={handleDeleteClick}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={setSort}
                page={safePage}
                totalPages={totalPages}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
            />
        );
    };

    return (
        <PageLayout>
            <div data-testid="history-page" className="contents">
                {showCompare && compareSessions.length >= 2 ? (
                    <SessionCompareModal sessions={compareSessions} onClose={() => setShowCompare(false)} />
                ) : selectedSession ? (
                    <HistorySessionDetail
                        session={selectedSession}
                        onBack={() => setSelectedId(null)}
                        onSaveAsProfile={setPromoteSessionId}
                        onSetReference={
                            focus
                                ? () => {
                                      if (settingReference) return;
                                      void setReference({
                                          id: focus.profileId,
                                          sourceSessionId: selectedSession.id,
                                          sourceSession: {
                                              tsv_path: selectedSession.tsv_path,
                                              bbp_tsv_path: selectedSession.bbp_tsv_path,
                                              bbp_seconds: selectedSession.bbp_seconds,
                                              events: selectedSession.events,
                                              heater_events: selectedSession.heater_events,
                                          },
                                      }).catch(() => {
                                          useToastStore.getState().show(t('profiles.detail.referenceFailed'));
                                      });
                                  }
                                : undefined
                        }
                    />
                ) : selectedId && (isRawLoading || isPaginatedLoading) ? (
                    <HistorySkeleton />
                ) : (
                    <>
                        <PageHeader
                            title={t('history.title')}
                            subtitle={
                                isLoading
                                    ? t('history.subtitleLoading')
                                    : t('history.subtitle', { count: totalSessions })
                            }
                            className="flex-col gap-4 md:flex-row"
                            actions={
                                <div className="flex items-center gap-2">
                                    {totalSessions > 1 && (
                                        <SurfaceButton
                                            onClick={handleToggleCompareMode}
                                            className={
                                                compareMode
                                                    ? 'border-transparent bg-action text-on-action hover:bg-action hover:opacity-85'
                                                    : undefined
                                            }
                                        >
                                            <GitCompare size={14} strokeWidth={2} />
                                            {compareMode ? t('history.compare.cancel') : t('history.compare.button')}
                                        </SurfaceButton>
                                    )}
                                    {compareMode && (
                                        <PillButton
                                            onClick={() => setShowCompare(true)}
                                            disabled={compareSessions.length < 2}
                                        >
                                            {t('history.compare.open', { count: compareSessions.length })}
                                        </PillButton>
                                    )}
                                    <PillButton onClick={() => setExportOpen(true)}>
                                        <Download size={14} strokeWidth={2} />
                                        {t('history.exportCsv')}
                                    </PillButton>
                                </div>
                            }
                        />

                        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
                            <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-64 h-10 rounded-xl border border-border bg-input-bg px-3 py-2 shadow-xs">
                                <Search size={14} strokeWidth={2} className="text-muted" />
                                <input
                                    className="w-full border-none bg-transparent text-[13px] tracking-[0.14px] text-primary outline-none placeholder:text-muted font-body"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={t('history.searchPlaceholder')}
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <FilterDropdown
                                    label={t('history.allLevels')}
                                    value={levelFilter}
                                    options={ROAST_LEVELS.filter((l) => rawSessions.some((s) => s.roast_level === l))}
                                    onSelect={setLevelFilter}
                                />
                                <FilterDropdown
                                    label={t('history.allOrigins')}
                                    value={originFilter}
                                    options={uniqueOrigins}
                                    onSelect={setOriginFilter}
                                />
                                <FilterDropdown
                                    label={t('history.table.profile')}
                                    value={profileFilter}
                                    options={[...profileOptions.keys()]}
                                    optionLabel={(id) => profileOptions.get(id) ?? id}
                                    onSelect={setProfileFilter}
                                />
                                <DateRangeFilter
                                    preset={datePreset}
                                    fromYM={fromYM}
                                    toYM={toYM}
                                    monthOptions={monthOptions}
                                    onPresetChange={setDatePreset}
                                    onFromYM={setFromYM}
                                    onToYM={setToYM}
                                />
                            </div>
                        </div>

                        {renderContent()}
                    </>
                )}
                {promoteSessionId != null && (
                    <NewProfileModal
                        open
                        initialSessionId={promoteSessionId}
                        onClose={() => setPromoteSessionId(null)}
                        onCreated={handleProfileCreated}
                    />
                )}
                <DeleteSessionModal
                    open={deletingId !== null}
                    sessionName={
                        deletingSession
                            ? `${sessionRoastTitle(deletingSession) ?? ''} (${formatDateTimeShort(deletingSession.roasted_at)})`.trim()
                            : ''
                    }
                    isLoading={deleteSession.isPending}
                    error={deleteError}
                    onClose={handleCloseDelete}
                    onConfirm={handleConfirmDelete}
                />
                <ExportCsvModal
                    open={exportOpen}
                    onClose={() => setExportOpen(false)}
                    monthOptions={monthOptions}
                    sessionsMeta={filterMeta}
                    onConfirm={handleExportConfirm}
                />
            </div>
        </PageLayout>
    );
};
