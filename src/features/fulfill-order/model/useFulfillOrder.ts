import { orderApi, orderKeys } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { productStockKeys } from '@entities/product-stock-event';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/** Fulfill an order via the atomic `fulfill_order` RPC (deduct stock + stamp fulfilled_at). */
export const useFulfillOrder = () => {
    const qc = useQueryClient();
    const { workspaceOwnerId } = useActiveWorkspace();

    return useMutation({
        mutationFn: (orderId: string) => orderApi.fulfill(orderId),
        onSuccess: () => {
            if (!workspaceOwnerId) return;
            qc.invalidateQueries({ queryKey: orderKeys.all(workspaceOwnerId) });
            qc.invalidateQueries({ queryKey: orderKeys.requirements(workspaceOwnerId) });
            qc.invalidateQueries({ queryKey: productStockKeys.byUser(workspaceOwnerId) });
        },
    });
};
