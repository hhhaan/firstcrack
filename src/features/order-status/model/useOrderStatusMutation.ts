import { orderApi } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { productStockKeys } from '@entities/product-stock-event';
import { orderKeys } from '@shared/lib/query-keys';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const useOrderStatusMutation = (action: 'cancel' | 'fulfill') => {
    const qc = useQueryClient();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();

    return useMutation({
        mutationFn: async (orderId: string) => {
            if (!isWorkspaceReady || !workspaceOwnerId) throw new Error('Workspace is still loading');
            await orderApi[action](orderId);
            return workspaceOwnerId;
        },
        onSuccess: (ownerId) => {
            void qc.invalidateQueries({ queryKey: orderKeys.all(ownerId) });
            void qc.invalidateQueries({ queryKey: orderKeys.requirements(ownerId) });
            void qc.invalidateQueries({ queryKey: productStockKeys.byUser(ownerId) });
        },
    });
};

/** Cancel via atomic `cancel_order` RPC (restore stock if fulfilled + status cancelled). */
export const useCancelOrder = () => useOrderStatusMutation('cancel');

/** Fulfill via atomic `fulfill_order` RPC (deduct stock + stamp fulfilled_at). */
export const useFulfillOrder = () => useOrderStatusMutation('fulfill');
