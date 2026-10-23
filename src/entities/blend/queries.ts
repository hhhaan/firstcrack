import { blendQueryRoots } from '@shared/lib/query-keys';
import type { Database } from '@shared/types/database.types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlendWithComponents } from './api';
import { blendApi } from './api';

type BlendInsert = Database['public']['Tables']['blends']['Insert'];
type BlendComponentInsert = Database['public']['Tables']['blend_components']['Insert'];

export const blendKeys = {
    all: (userId: string) => [...blendQueryRoots.all, userId] as const,
    detail: (id: string) => ['blends', 'detail', id] as const,
};

export const useBlends = (userId: string, options?: { enabled?: boolean }) =>
    useQuery({
        queryKey: blendKeys.all(userId),
        queryFn: () => blendApi.list(userId),
        enabled: !!userId && (options?.enabled ?? true),
    });

export const useBlend = (id: string) =>
    useQuery({
        queryKey: blendKeys.detail(id),
        queryFn: () => blendApi.get(id),
        enabled: !!id,
    });

export const useCreateBlend = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            blend,
            components,
        }: {
            blend: BlendInsert;
            components: Omit<BlendComponentInsert, 'blend_id'>[];
        }) => blendApi.create(blend, components),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: blendKeys.all(userId) });
        },
    });
};

export const useUpdateBlend = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            id,
            patch,
            components,
        }: {
            id: string;
            patch: Parameters<typeof blendApi.update>[1];
            components: Parameters<typeof blendApi.update>[2];
        }) => blendApi.update(id, patch, components),
        onSuccess: (updated: BlendWithComponents) => {
            qc.setQueryData(blendKeys.detail(updated.id), updated);
            void qc.invalidateQueries({ queryKey: blendKeys.all(userId) });
        },
    });
};

export const useDeleteBlend = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: blendApi.delete,
        // biome-ignore lint/suspicious/noConfusingVoidType: matches mutation return type
        onSuccess: (_data: void, id: string) => {
            qc.removeQueries({ queryKey: blendKeys.detail(id) });
            void qc.invalidateQueries({ queryKey: blendKeys.all(userId) });
        },
    });
};
