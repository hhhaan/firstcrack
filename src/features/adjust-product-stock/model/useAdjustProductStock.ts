import { useActiveWorkspace } from '@entities/organization';
import { productStockEventApi, productStockKeys } from '@entities/product-stock-event';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildProductAdjustEvent, type ProductAdjustParams } from '../lib/buildProductAdjustEvent';

export type AdjustProductParams = Omit<ProductAdjustParams, 'userId' | 'referenceId'>;

export const useAdjustProductStock = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();

    return useMutation({
        mutationFn: async (p: AdjustProductParams) => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');
            const event = buildProductAdjustEvent({
                ...p,
                userId: workspaceOwnerId,
                referenceId: crypto.randomUUID(),
            });
            if (!event) throw new Error('Invalid adjust amount');
            await productStockEventApi.insertMany([event]);
            return workspaceOwnerId;
        },
        onSuccess: (ownerId) => {
            void qc.invalidateQueries({ queryKey: productStockKeys.byUser(ownerId) });
        },
    });
};
