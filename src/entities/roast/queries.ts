import { dashboardKeys, inventoryQueryRoots, roastedStockKeys, roastProfileQueryRoots } from '@shared/lib/query-keys';
import { isClientRefusal } from '@shared/lib/sentry';
import { shouldPrefetchNextPage } from '@shared/lib/shouldPrefetchNextPage';
import type { RoastSession, RoastSessionWithRelations } from '@shared/types/database.types';
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roastSessionApi } from './api';

const roastSessionRoot = (userId: string) => ['roast_sessions', userId] as const;

export const roastSessionKeys = {
    all: roastSessionRoot,
    byStatus: (userId: string, status: string) => [...roastSessionRoot(userId), status] as const,
    detail: (userId: string, id: string) => [...roastSessionRoot(userId), 'detail', id] as const,
    paginated: (userId: string, ...params: unknown[]) => [...roastSessionRoot(userId), 'paginated', ...params] as const,
    infinite: (userId: string, ...params: unknown[]) => [...roastSessionRoot(userId), 'infinite', ...params] as const,
    completedCount: (userId: string) => [...roastSessionRoot(userId), 'completed_count'] as const,
    completedMonthCount: (userId: string) => [...roastSessionRoot(userId), 'completed_month_count'] as const,
    filterMeta: (userId: string) => [...roastSessionRoot(userId), 'filter_meta'] as const,
};

type PaginatedSessions = { data: RoastSessionWithRelations[]; total: number };
type InfiniteSessions = { pages: PaginatedSessions[]; pageParams: unknown[] };

/**
 * Shared after create/update/delete/setOutput and, through record edit, after a saved-record patch.
 * Active Roast save calls this too (`refreshCachesAfterRoastSave`).
 * Nested keys under `all(userId)` mean one prefix invalidation covers lists, pages, counts, filterMeta, detail.
 * Bean history and consistency are profile-id suffixes of shared roots, so one prefix drops every profile
 * (a profile link change must not leave the previous profile stale).
 * `refetchType: 'all'` — these reads are often unmounted; default `active` left Infinity caches stale.
 */
export const invalidateRoastSessionQueries = async (qc: QueryClient, userId: string) => {
    await Promise.all([
        qc.invalidateQueries({ queryKey: roastSessionKeys.all(userId), refetchType: 'all' }),
        qc.invalidateQueries({ queryKey: dashboardKeys.all(userId), refetchType: 'all' }),
        qc.invalidateQueries({ queryKey: roastProfileQueryRoots.beanHistory, refetchType: 'all' }),
        qc.invalidateQueries({ queryKey: roastProfileQueryRoots.consistency, refetchType: 'all' }),
    ]);
};

/** Alias used by Active Roast save — same helper as update/delete/setOutput. */
export const invalidateAfterCreateRoastSession = invalidateRoastSessionQueries;

/** Prefix `setQueriesData` — `getQueryData(paginated(userId))` misses page caches that append params. */
export const applyOptimisticRoastSessionDelete = (qc: QueryClient, userId: string, id: string) => {
    const prevAll = qc.getQueryData<RoastSessionWithRelations[]>(roastSessionKeys.all(userId));
    const prevPaginated = qc.getQueriesData<PaginatedSessions>({
        queryKey: roastSessionKeys.paginated(userId),
    });
    const prevInfinite = qc.getQueriesData<InfiniteSessions>({
        queryKey: roastSessionKeys.infinite(userId),
    });

    if (prevAll) {
        qc.setQueryData(
            roastSessionKeys.all(userId),
            prevAll.filter((s) => s.id !== id),
        );
    }
    qc.setQueriesData<PaginatedSessions>({ queryKey: roastSessionKeys.paginated(userId) }, (prev) => {
        if (!prev) return prev;
        return {
            ...prev,
            data: prev.data.filter((s) => s.id !== id),
            total: Math.max(0, prev.total - 1),
        };
    });
    qc.setQueriesData<InfiniteSessions>({ queryKey: roastSessionKeys.infinite(userId) }, (prev) => {
        if (!prev) return prev;
        const hit = prev.pages.some((page) => page.data.some((s) => s.id === id));
        return {
            ...prev,
            pages: prev.pages.map((page) => ({
                ...page,
                data: page.data.filter((s) => s.id !== id),
                total: hit ? Math.max(0, page.total - 1) : page.total,
            })),
        };
    });

    return { prevAll, prevPaginated, prevInfinite };
};

export const restoreOptimisticRoastSessionDelete = (
    qc: QueryClient,
    userId: string,
    ctx: ReturnType<typeof applyOptimisticRoastSessionDelete>,
) => {
    if (ctx.prevAll) qc.setQueryData(roastSessionKeys.all(userId), ctx.prevAll);
    for (const [key, data] of ctx.prevPaginated) {
        qc.setQueryData(key, data);
    }
    for (const [key, data] of ctx.prevInfinite) {
        qc.setQueryData(key, data);
    }
};

const isPaginatedSessions = (old: unknown): old is PaginatedSessions =>
    !!old && typeof old === 'object' && 'data' in old && Array.isArray((old as PaginatedSessions).data);

const isInfiniteSessions = (old: unknown): old is InfiniteSessions =>
    !!old &&
    typeof old === 'object' &&
    Array.isArray((old as InfiniteSessions).pages) &&
    (old as InfiniteSessions).pages.every(isPaginatedSessions);

const isSessionRow = (row: unknown): row is RoastSessionWithRelations =>
    !!row && typeof row === 'object' && 'id' in row && 'status' in row;

/** Patch tsv paths into session caches under `all(userId)` — never the raw `['roast_sessions']` prefix. */
export const patchRoastSessionTsvPaths = (
    qc: QueryClient,
    userId: string,
    roastSessionId: string,
    key: string | null,
    bbpKey: string | null,
) => {
    const patch = (row: RoastSessionWithRelations) =>
        row.id === roastSessionId
            ? { ...row, tsv_path: key ?? row.tsv_path, bbp_tsv_path: bbpKey ?? row.bbp_tsv_path }
            : row;

    qc.setQueriesData({ queryKey: roastSessionKeys.all(userId) }, (old: unknown) => {
        if (Array.isArray(old)) {
            if (old.length === 0) return old;
            if (!isSessionRow(old[0])) return old;
            return old.map(patch);
        }
        if (isInfiniteSessions(old)) {
            return { ...old, pages: old.pages.map((page) => ({ ...page, data: page.data.map(patch) })) };
        }
        if (isPaginatedSessions(old)) return { ...old, data: old.data.map(patch) };
        if (isSessionRow(old)) return patch(old);
        return old;
    });
    void qc.invalidateQueries({ queryKey: roastSessionKeys.detail(userId, roastSessionId) });
};

/** Lifetime completed sessions — trial quota display. */
export const useCompletedSessionCount = (userId: string) =>
    useQuery({
        queryKey: roastSessionKeys.completedCount(userId),
        queryFn: () => roastSessionApi.countCompletedTotal(userId),
        staleTime: Infinity,
        enabled: !!userId,
    });

/** Completed sessions this month — pro monthly quota. */
export const useCompletedMonthSessionCount = (userId: string) =>
    useQuery({
        queryKey: roastSessionKeys.completedMonthCount(userId),
        queryFn: () => roastSessionApi.countCompletedThisMonth(userId),
        staleTime: Infinity,
        enabled: !!userId,
    });

export const useRoastSessions = (userId: string, status?: RoastSession['status'], options?: { enabled?: boolean }) =>
    useQuery({
        queryKey: status ? roastSessionKeys.byStatus(userId, status) : roastSessionKeys.all(userId),
        queryFn: () => roastSessionApi.list(userId, status),
        staleTime: Infinity,
        refetchOnMount: true,
        enabled: !!userId && (options?.enabled ?? true),
    });

export const useRoastSessionFilterMeta = (userId: string) =>
    useQuery({
        queryKey: roastSessionKeys.filterMeta(userId),
        queryFn: () => roastSessionApi.listFilterMeta(userId),
        staleTime: Infinity,
        refetchOnMount: true,
        enabled: !!userId,
    });

export const useRoastSession = (userId: string, id: string) =>
    useQuery({
        queryKey: roastSessionKeys.detail(userId, id),
        queryFn: () => roastSessionApi.get(id),
        enabled: !!userId && !!id,
    });

export const useCreateRoastSession = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.create,
        retry: (failureCount, error) => !isClientRefusal(error) && failureCount < 3,
        onSuccess: () => {
            void invalidateRoastSessionQueries(qc, userId);
        },
    });
};

export const useUpdateRoastSession = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.update,
        onSuccess: (updated) => {
            qc.setQueryData<RoastSessionWithRelations>(roastSessionKeys.detail(userId, updated.id), (prev) =>
                prev ? { ...prev, ...updated } : undefined,
            );
            void invalidateRoastSessionQueries(qc, userId);
        },
    });
};

export const useRoastSessionsPaginated = (params: {
    userId: string;
    status?: RoastSession['status'];
    page: number;
    pageSize: number;
    sortKey?: string;
    sortAsc?: boolean;
    level?: string | null;
    fromYM?: string | null;
    toYM?: string | null;
    enabled?: boolean;
}) => {
    const enabled = !!params.userId && (params.enabled ?? true);
    const pageKey = (page: number) =>
        roastSessionKeys.paginated(
            params.userId,
            params.status ?? null,
            page,
            params.pageSize,
            params.sortKey,
            params.sortAsc,
            params.level,
            params.fromYM,
            params.toYM,
        );
    const query = useQuery({
        queryKey: pageKey(params.page),
        queryFn: () => roastSessionApi.listPaginated(params),
        staleTime: Infinity,
        // Remount after save must not reuse stale cached pages (staleTime Infinity).
        refetchOnMount: true,
        // Same as Orders: keep previous rows on page/filter key changes instead of a skeleton.
        placeholderData: (prev) => prev,
        enabled,
    });
    const nextPage = params.page + 1;
    // Active subscribe (not prefetchQuery) so default invalidateQueries refreshes N+1 too.
    useQuery({
        queryKey: pageKey(nextPage),
        queryFn: () => roastSessionApi.listPaginated({ ...params, page: nextPage }),
        staleTime: Infinity,
        refetchOnMount: true,
        enabled: shouldPrefetchNextPage({
            enabled,
            page: params.page,
            pageSize: params.pageSize,
            total: query.data?.total,
            isSuccess: query.isSuccess,
            isPlaceholderData: query.isPlaceholderData,
        }),
    });
    return query;
};

const INFINITE_PAGE_SIZE = 10;

/** Completed roasts, 10 per page. The background picker scrolls to the next page. */
export const useRoastSessionsInfinite = (userId: string, status?: RoastSession['status'], enabled = true) =>
    useInfiniteQuery({
        queryKey: roastSessionKeys.infinite(userId, status ?? null, INFINITE_PAGE_SIZE),
        queryFn: ({ pageParam }) =>
            roastSessionApi.listPaginated({
                userId,
                status,
                page: pageParam,
                pageSize: INFINITE_PAGE_SIZE,
                sortKey: 'date',
                sortAsc: false,
            }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, _pages, pageParam) =>
            pageParam * INFINITE_PAGE_SIZE >= lastPage.total ? undefined : pageParam + 1,
        staleTime: Infinity,
        refetchOnMount: true,
        enabled: !!userId && enabled,
    });

export const useDeleteRoastSession = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.delete,
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: roastSessionKeys.all(userId) });
            return applyOptimisticRoastSessionDelete(qc, userId, id);
        },
        onError: (_err, _id, context) => {
            if (context) restoreOptimisticRoastSessionDelete(qc, userId, context);
        },
        onSettled: (_data, _err, id) => {
            void invalidateRoastSessionQueries(qc, userId);
            void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockEvents });
            void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries });
            void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(userId) });
            qc.removeQueries({ queryKey: roastSessionKeys.detail(userId, id) });
        },
    });
};

export const isRoastRecordConflict = (error: unknown): boolean => {
    const e = error as { code?: unknown; message?: unknown } | null;
    return e?.code === 'PT409' || (typeof e?.message === 'string' && e.message.includes('roast_record_conflict'));
};

/**
 * Event/Heat set edit of a saved record. Refreshes every roast-session read (list, pages,
 * detail, dashboard) and profiles derived from the record. Inventory caches are untouched on purpose.
 */
export const useUpdateRoastRecord = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.updateRecord,
        // Editors keep the draft open and show the failure inline.
        meta: { silentError: true },
        onSuccess: (updated) => {
            qc.setQueryData<RoastSessionWithRelations>(roastSessionKeys.detail(userId, updated.id), (prev) =>
                prev ? { ...prev, ...updated } : undefined,
            );
        },
        onSettled: () => {
            void invalidateAfterRoastRecordEdit(qc, userId);
        },
    });
};

/** Session reads + profile rows cut from the record. Stats ride `invalidateRoastSessionQueries`. */
export const invalidateAfterRoastRecordEdit = async (qc: QueryClient, userId: string) => {
    await Promise.all([
        invalidateRoastSessionQueries(qc, userId),
        qc.invalidateQueries({ queryKey: roastProfileQueryRoots.profiles, refetchType: 'all' }),
    ]);
};

/** Atomic output weight + roasted inbound upsert. */
export const useSetOutputWeight = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.setOutputWeight,
        onSuccess: () => {
            void invalidateRoastSessionQueries(qc, userId);
            void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(userId) });
        },
    });
};

/** Charge correction: session weight, session-owned green deduct, roasted inbound. */
export const useSetChargeWeight = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.setChargeWeight,
        onSuccess: () => {
            void invalidateRoastSessionQueries(qc, userId);
            void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockEvents });
            void qc.invalidateQueries({ queryKey: inventoryQueryRoots.beanStockSummaries });
            void qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(userId) });
        },
    });
};
