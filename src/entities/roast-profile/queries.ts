import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { roastProfileApi } from './api';
import type { RoastProfile } from '@shared/types/database.types';

export const roastProfileKeys = {
    all: (userId: string) => ['roast_profiles', userId] as const,
    detail: (id: string) => ['roast_profiles', 'detail', id] as const,
};

export const useRoastProfiles = (userId: string) =>
    useQuery({
        queryKey: roastProfileKeys.all(userId),
        queryFn: () => roastProfileApi.list(userId),
        staleTime: 30_000,
        enabled: !!userId,
    });

export const useCreateRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.create,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
        },
    });
};

export const useUpdateRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.update,
        onSuccess: (updated) => {
            qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
            qc.setQueryData<RoastProfile>(roastProfileKeys.detail(updated.id), updated);
        },
    });
};

export const useDeleteRoastProfile = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: roastProfileApi.delete,
        onSuccess: (_, id) => {
            qc.invalidateQueries({ queryKey: roastProfileKeys.all(userId) });
            qc.removeQueries({ queryKey: roastProfileKeys.detail(id) });
        },
    });
};
