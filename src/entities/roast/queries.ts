import { dashboardKeys } from '@shared/lib/query-keys';
import type { RoastSession, RoastSessionWithRelations } from '@shared/types/database.types';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roastSessionApi } from './api';

export const roastSessionKeys = {
    all: (userId: string) => ['roast_sessions', userId] as const,
    byStatus: (userId: string, status: string) => ['roast_sessions', userId, status] as const,
    detail: (id: string) => ['roast_sessions', 'detail', id] as const,
    paginated: (userId: string) => ['roast_sessions', 'paginated', userId] as const,
    completedCount: (userId: string) => ['roast_sessions', 'completed_count', userId] as const,
};

/** Keys invalidated after create (staleTime Infinity → must not omit). */
export const invalidateAfterCreateRoastSession = (qc: QueryClient, userId: string) => {
    void qc.invalidateQueries({ queryKey: roastSessionKeys.all(userId) });
    void qc.invalidateQueries({ queryKey: roastSessionKeys.paginated(userId) });
    void qc.invalidateQueries({ queryKey: roastSessionKeys.completedCount(userId) });
    void qc.invalidateQueries({ queryKey: dashboardKeys.all(userId) });
};

/** Lifetime completed sessions — trial quota display. */
export const useCompletedSessionCount = (userId: string) =>
    useQuery({
        queryKey: roastSessionKeys.completedCount(userId),
        queryFn: () => roastSessionApi.countCompletedTotal(userId),
        staleTime: Infinity,
        enabled: !!userId,
    });

export const useRoastSessions = (userId: string, status?: RoastSession['status']) =>
    useQuery({
        queryKey: status ? roastSessionKeys.byStatus(userId, status) : roastSessionKeys.all(userId),
        queryFn: () => roastSessionApi.list(userId, status),
        staleTime: Infinity,
        enabled: !!userId,
    });

export const useRoastSession = (id: string) =>
    useQuery({
        queryKey: roastSessionKeys.detail(id),
        queryFn: () => roastSessionApi.get(id),
        enabled: !!id,
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
            invalidateAfterCreateRoastSession(qc, userId);
        },
    });
};

export const useUpdateRoastSession = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.update,
        onSuccess: (updated) => {
            void qc.invalidateQueries({ queryKey: roastSessionKeys.all(userId) });
            void qc.invalidateQueries({ queryKey: roastSessionKeys.paginated(userId) });
            qc.setQueryData<RoastSessionWithRelations>(roastSessionKeys.detail(updated.id), (prev) =>
                prev ? { ...prev, ...updated } : undefined,
            );
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
        queryKey: [
            'roast_sessions',
            'paginated',
            params.userId,
            params.page,
            params.sortKey,
            params.sortAsc,
            params.level,
            params.fromYM,
            params.toYM,
        ],
        queryFn: () => roastSessionApi.listPaginated(params),
        staleTime: Infinity,
        enabled: !!params.userId && (params.enabled ?? true),
    });

export const useDeleteRoastSession = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.delete,
        onMutate: async (id) => {
            await qc.cancelQueries({ queryKey: roastSessionKeys.all(userId) });
            await qc.cancelQueries({ queryKey: roastSessionKeys.paginated(userId) });

            const prevAll = qc.getQueryData<RoastSessionWithRelations[]>(roastSessionKeys.all(userId));
            const prevPaginated = qc.getQueryData<{ data: RoastSessionWithRelations[]; total: number }>(
                roastSessionKeys.paginated(userId),
            );

            if (prevAll) {
                qc.setQueryData<RoastSessionWithRelations[]>(
                    roastSessionKeys.all(userId),
                    prevAll.filter((s) => s.id !== id),
                );
            }
            if (prevPaginated) {
                qc.setQueryData<{ data: RoastSessionWithRelations[]; total: number }>(
                    roastSessionKeys.paginated(userId),
                    {
                        ...prevPaginated,
                        data: prevPaginated.data.filter((s) => s.id !== id),
                        total: prevPaginated.total - 1,
                    },
                );
            }

            return { prevAll, prevPaginated };
        },
        onError: (_err, _id, context) => {
            if (context?.prevAll) qc.setQueryData(roastSessionKeys.all(userId), context.prevAll);
            if (context?.prevPaginated) qc.setQueryData(roastSessionKeys.paginated(userId), context.prevPaginated);
        },
        onSettled: (_data, _err, id) => {
            void qc.invalidateQueries({ queryKey: roastSessionKeys.all(userId) });
            void qc.invalidateQueries({ queryKey: roastSessionKeys.paginated(userId) });
            qc.removeQueries({ queryKey: roastSessionKeys.detail(id) });
        },
    });
};
