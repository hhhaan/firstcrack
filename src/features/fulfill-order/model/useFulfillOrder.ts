import { orderApi } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { productStockKeys } from '@entities/product-stock-event';
import { orderKeys } from '@shared/lib/query-keys';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/** Fulfill an order via the atomic `fulfill_order` RPC (deduct stock + stamp fulfilled_at). */
export const useFulfillOrder = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();

    return useMutation({
        mutationFn: async (orderId: string) => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');
            await orderApi.fulfill(orderId);
            return workspaceOwnerId;
        },
        onSuccess: (ownerId) => {
            qc.invalidateQueries({ queryKey: orderKeys.all(ownerId) });
            qc.invalidateQueries({ queryKey: orderKeys.requirements(ownerId) });
            qc.invalidateQueries({ queryKey: productStockKeys.byUser(ownerId) });
        },
    });
};
