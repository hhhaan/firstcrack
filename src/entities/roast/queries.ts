import { dashboardKeys, inventoryQueryRoots, roastedStockKeys } from '@shared/lib/query-keys';
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
    recentFc: (userId: string, beanId: string | null, profileId: string | null) =>
        [...roastSessionRoot(userId), 'recent_fc', beanId ?? '', profileId ?? ''] as const,
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
    key: string,
    bbpKey: string | null,
) => {
    const patch = (row: RoastSessionWithRelations) =>
        row.id === roastSessionId ? { ...row, tsv_path: key, bbp_tsv_path: bbpKey ?? row.bbp_tsv_path } : row;

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

/** Last N completed-session events for same bean (else same profile) — FC-target median. */
export const useRecentFcEvents = (userId: string, beanId: string | null, profileId: string | null) =>
    useQuery({
        queryKey: roastSessionKeys.recentFc(userId, beanId, profileId),
        queryFn: () => roastSessionApi.listRecentEvents({ userId, beanId, profileId }),
        staleTime: Infinity,
        enabled: !!userId && (!!beanId || !!profileId),
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
}) =>
    useQuery({
        queryKey: roastSessionKeys.paginated(
            params.userId,
            params.status ?? null,
            params.page,
            params.pageSize,
            params.sortKey,
            params.sortAsc,
            params.level,
            params.fromYM,
            params.toYM,
        ),
        queryFn: () => roastSessionApi.listPaginated(params),
        staleTime: Infinity,
        // Remount after save must not reuse stale cached pages (staleTime Infinity).
        refetchOnMount: true,
        enabled: !!params.userId && (params.enabled ?? true),
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
