import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { blendApi } from './api';
import type { BlendWithComponents } from './api';
import type { Database } from '@shared/types/database.types';

type BlendInsert = Database['public']['Tables']['blends']['Insert'];
type BlendComponentInsert = Database['public']['Tables']['blend_components']['Insert'];

export const blendKeys = {
  all: (userId: string) => ['blends', userId] as const,
  detail: (id: string) => ['blends', 'detail', id] as const,
};

export const useBlends = (userId: string) =>
  useQuery({
    queryKey: blendKeys.all(userId),
    queryFn: () => blendApi.list(userId),
    enabled: !!userId,
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
      qc.invalidateQueries({ queryKey: blendKeys.all(userId) });
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
      qc.invalidateQueries({ queryKey: blendKeys.all(userId) });
    },
  });
};

export const useDeleteBlend = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: blendApi.delete,
    onSuccess: (_data: void, id: string) => {
      qc.removeQueries({ queryKey: blendKeys.detail(id) });
      qc.invalidateQueries({ queryKey: blendKeys.all(userId) });
    },
  });
};
