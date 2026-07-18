import { orderKeys } from '@shared/lib/query-keys';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderInsert, OrderLineInsert } from './api';
import { orderApi } from './api';

export { orderKeys };

/** Keys invalidated after create order (staleTime Infinity → must not omit). */
export const invalidateAfterCreateOrder = (qc: QueryClient, userId: string) => {
    qc.invalidateQueries({ queryKey: orderKeys.all(userId) });
    qc.invalidateQueries({ queryKey: orderKeys.requirements(userId) });
};

export const useOrders = (userId: string) =>
    useQuery({
        queryKey: orderKeys.all(userId),
        queryFn: () => orderApi.list(userId),
        enabled: !!userId,
    });

export const useRoastingRequirements = (userId: string) =>
    useQuery({
        queryKey: orderKeys.requirements(userId),
        queryFn: () => orderApi.getRoastingRequirements(userId),
        enabled: !!userId,
    });

export const useCreateOrder = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({
            order,
            lines,
        }: {
            order: OrderInsert;
            lines: Omit<OrderLineInsert, 'order_id' | 'user_id'>[];
        }) => orderApi.create(order, lines),
        onSuccess: () => {
            invalidateAfterCreateOrder(qc, userId);
        },
    });
};
