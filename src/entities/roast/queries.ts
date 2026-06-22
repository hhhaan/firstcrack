import type { RoastSession, RoastSessionWithRelations } from '@shared/types/database.types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roastSessionApi } from './api';

export const roastSessionKeys = {
    all: (userId: string) => ['roast_sessions', userId] as const,
    byStatus: (userId: string, status: string) => ['roast_sessions', userId, status] as const,
    detail: (id: string) => ['roast_sessions', 'detail', id] as const,
};

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

export const useCreateRoastSession = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.create,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: roastSessionKeys.all(userId) });
            qc.invalidateQueries({ queryKey: ['dashboard', userId] });
        },
    });
};

export const useUpdateRoastSession = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastSessionApi.update,
        onSuccess: (updated) => {
            qc.invalidateQueries({ queryKey: roastSessionKeys.all(userId) });
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
            await qc.cancelQueries({ queryKey: ['roast_sessions', 'paginated', userId] });

            const prevAll = qc.getQueryData<RoastSessionWithRelations[]>(roastSessionKeys.all(userId));
            const prevPaginated = qc.getQueryData<{ data: RoastSessionWithRelations[]; total: number }>([
                'roast_sessions',
                'paginated',
                userId,
            ]);

            if (prevAll) {
                qc.setQueryData<RoastSessionWithRelations[]>(
                    roastSessionKeys.all(userId),
                    prevAll.filter((s) => s.id !== id),
                );
            }
            if (prevPaginated) {
                qc.setQueryData<{ data: RoastSessionWithRelations[]; total: number }>(
                    ['roast_sessions', 'paginated', userId],
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
            if (context?.prevPaginated) qc.setQueryData(['roast_sessions', 'paginated', userId], context.prevPaginated);
        },
        onSettled: (_data, _err, id) => {
            qc.invalidateQueries({ queryKey: roastSessionKeys.all(userId) });
            qc.invalidateQueries({ queryKey: ['roast_sessions', 'paginated', userId] });
            qc.removeQueries({ queryKey: roastSessionKeys.detail(id) });
        },
    });
};
