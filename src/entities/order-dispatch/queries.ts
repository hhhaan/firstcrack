import { orderKeys, productStockKeys } from '@shared/lib/query-keys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orderDispatchApi } from './api';

export const orderDispatchKeys = {
    all: (userId: string) => ['order-dispatches', userId] as const,
    byOrders: (userId: string, ids: string[]) => ['order-dispatches', userId, 'orders', ids] as const,
};

export const useOrderDispatches = (userId: string, orderIds: string[]) => {
    const ids = [...new Set(orderIds)].sort();
    return useQuery({
        queryKey: orderDispatchKeys.byOrders(userId, ids),
        queryFn: () => orderDispatchApi.listByOrders(userId, ids),
        enabled: !!userId && ids.length > 0,
    });
};

export const useDispatchOrder = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: { orderId: string; carrier: string; trackingNumber: string }) =>
            orderDispatchApi.dispatch(input),
        // DispatchModal keeps itself open and renders the failure inline.
        meta: { silentError: true },
        onSuccess: (res) => {
            void qc.invalidateQueries({ queryKey: orderDispatchKeys.all(userId) });
            void qc.invalidateQueries({ queryKey: orderKeys.all(userId) });
            // C3: dispatch may call fulfill_order — mirror useFulfillOrder invalidation
            if (res.fulfilled) {
                void qc.invalidateQueries({ queryKey: productStockKeys.byUser(userId) });
                void qc.invalidateQueries({ queryKey: orderKeys.requirements(userId) });
            }
        },
    });
};
