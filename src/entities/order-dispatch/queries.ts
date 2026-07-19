import { productStockKeys } from '@entities/product-stock-event';
import { orderKeys } from '@shared/lib/query-keys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orderDispatchApi } from './api';

export const orderDispatchKeys = {
    all: (userId: string) => ['order-dispatches', userId] as const,
};

export const useOrderDispatches = (userId: string) =>
    useQuery({
        queryKey: orderDispatchKeys.all(userId),
        queryFn: () => orderDispatchApi.listByUser(userId),
        enabled: !!userId,
    });

export const useDispatchOrder = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input: { orderId: string; carrier: string; trackingNumber: string }) =>
            orderDispatchApi.dispatch(input),
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
