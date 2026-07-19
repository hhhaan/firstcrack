import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, ProductInsert, ProductUpdate } from './api';
import { productApi } from './api';

export const productKeys = {
    all: (userId: string) => ['products', userId] as const,
};

export const useProducts = (userId: string) =>
    useQuery({
        queryKey: productKeys.all(userId),
        queryFn: () => productApi.list(userId),
        enabled: !!userId,
    });

export const useCreateProduct = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (product: ProductInsert) => productApi.create(product),
        onSuccess: () => qc.invalidateQueries({ queryKey: productKeys.all(userId) }),
    });
};

export const useUpdateProduct = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: ProductUpdate }) => productApi.update(id, patch),
        onSuccess: (updated: Product) => {
            qc.setQueryData<Product[]>(productKeys.all(userId), (prev) =>
                prev?.map((p) => (p.id === updated.id ? updated : p)),
            );
        },
    });
};

export const useDeleteProduct = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: productApi.delete,
        onSuccess: (_void, id) => {
            void qc.invalidateQueries({ queryKey: productKeys.all(userId) });
            const stockKey = [...inventoryQueryRoots.productStock, userId] as const;
            qc.setQueryData<Record<string, number>>(stockKey, (prev) => {
                if (!prev || !(id in prev)) return prev;
                const next = { ...prev };
                delete next[id];
                return next;
            });
        },
    });
};
