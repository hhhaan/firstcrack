import { dashboardKeys, inventoryQueryRoots, roastedStockKeys } from '@shared/lib/query-keys';
import { shouldPrefetchNextPage } from '@shared/lib/shouldPrefetchNextPage';
import type { RoastSession, RoastSessionWithRelations } from '@shared/types/database.types';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roastSessionApi } from './api';

const roastSessionRoot = (userId: string) => ['roast_sessions', userId] as const;

export const roastSessionKeys = {
    all: roastSessionRoot,
    byStatus: (userId: string, status: string) => [...roastSessionRoot(userId), status] as const,
    detail: (userId: string, id: string) => [...roastSessionRoot(userId), 'detail', id] as const,
    paginated: (userId: string, ...params: unknown[]) => [...roastSessionRoot(userId), 'paginated', ...params] as const,
    completedCount: (userId: string) => [...roastSessionRoot(userId), 'completed_count'] as const,
    completedMonthCount: (userId: string) => [...roastSessionRoot(userId), 'completed_month_count'] as const,
    filterMeta: (userId: string) => [...roastSessionRoot(userId), 'filter_meta'] as const,
};

type PaginatedSessions = { data: RoastSessionWithRelations[]; total: number };

/**
 * Shared after create/update/delete/setOutput.
 * Nested keys under `all(userId)` mean one prefix invalidation covers lists, pages, counts, filterMeta, detail.
 * `refetchType: 'all'` — History/dashboard are often unmounted; default `active` left Infinity caches stale.
 */
export const invalidateRoastSessionQueries = async (qc: QueryClient, userId: string) => {
    await Promise.all([
        qc.invalidateQueries({ queryKey: roastSessionKeys.all(userId), refetchType: 'all' }),
        qc.invalidateQueries({ queryKey: dashboardKeys.all(userId), refetchType: 'all' }),
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

    return { prevAll, prevPaginated };
};

const isDefaultHistoryFirstPage = (key: readonly unknown[], userId: string) => {
    if (key[0] !== 'roast_sessions' || key[1] !== userId || key[2] !== 'paginated') return false;
    const status = key[3];
    const page = key[4];
    const sortKey = key[6];
    const sortAsc = key[7];
    const level = key[8];
    const fromYM = key[9];
    const toYM = key[10];
    if (page !== 1) return false;
    if (status != null && status !== 'completed') return false;
    if (sortKey != null && sortKey !== 'date') return false;
    if (sortAsc != null && sortAsc !== false) return false;
    return level == null && fromYM == null && toYM == null;
};

const asHistoryRow = (row: RoastSession): RoastSessionWithRelations =>
    'beans' in row && 'roast_profiles' in row
        ? (row as RoastSessionWithRelations)
        : { ...row, beans: null, roast_profiles: null };

/** Confirmed save on the default first page. Bare RPC rows are shown without invented joins. */
export const insertConfirmedRoastOnFirstPage = (qc: QueryClient, userId: string, row: RoastSession): void => {
    if (row.user_id !== userId) return;
    const confirmed = asHistoryRow(row);
    for (const query of qc.getQueryCache().findAll({ queryKey: roastSessionKeys.paginated(userId) })) {
        if (!isDefaultHistoryFirstPage(query.queryKey, userId)) continue;
        const pageSize = query.queryKey[5];
        qc.setQueryData<PaginatedSessions>(query.queryKey, (prev) => {
            if (!prev || prev.data.some((session) => session.id === confirmed.id)) return prev;
            const newest = prev.data[0]?.roasted_at ?? null;
            if (prev.data.length > 0 && (!confirmed.roasted_at || !newest || confirmed.roasted_at < newest)) {
                return prev;
            }
            const limit = typeof pageSize === 'number' ? pageSize : prev.data.length + 1;
            return { data: [confirmed, ...prev.data].slice(0, limit), total: prev.total + 1 };
        });
    }
    const detailKey = roastSessionKeys.detail(userId, confirmed.id);
    if (qc.getQueryData(detailKey) == null) qc.setQueryData(detailKey, confirmed);
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
};

const isPaginatedSessions = (old: unknown): old is PaginatedSessions =>
    !!old && typeof old === 'object' && 'data' in old && Array.isArray((old as PaginatedSessions).data);

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

const is4xx = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    const status =
        (error as Record<string, unknown>).status ?? (error as { response?: { status?: unknown } }).response?.status;
    return typeof status === 'number' && status >= 400 && status < 500;
};

export const useCreateRoastSession = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.create,
        retry: (failureCount, error) => !is4xx(error) && failureCount < 3,
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
