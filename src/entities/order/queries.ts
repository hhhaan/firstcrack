import { orderKeys } from '@shared/lib/query-keys';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderInsert, OrderLineInsert, OrderPageParams } from './api';
import { orderApi } from './api';

export { orderKeys };

/** Keys invalidated after create order (staleTime Infinity → must not omit). */
export const invalidateAfterCreateOrder = (qc: QueryClient, userId: string) => {
    void qc.invalidateQueries({ queryKey: orderKeys.all(userId) });
    void qc.invalidateQueries({ queryKey: orderKeys.requirements(userId) });
};

export const useOrdersPaginated = (params: OrderPageParams) =>
    useQuery({
        queryKey: orderKeys.paginated(params.userId, {
            page: params.page,
            pageSize: params.pageSize,
            status: params.status,
            platform: params.platform,
            search: params.search,
            fromYM: params.fromYM,
            toYM: params.toYM,
        }),
        queryFn: () => orderApi.listPaginated(params),
        enabled: !!params.userId,
        // Page N stays on screen while page N+1 loads, instead of flashing the skeleton.
        placeholderData: (prev) => prev,
    });

export const useRoastingRequirements = (userId: string) =>
    useQuery({
        queryKey: orderKeys.requirements(userId),
        queryFn: () => orderApi.getRoastingRequirements(userId),
        enabled: !!userId,
    });

export const useSetOrderLineProduct = (userId: string) => {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ lineId, productId }: { lineId: string; productId: string }) =>
            orderApi.setLineProduct(lineId, productId),
        onSuccess: () => {
            invalidateAfterCreateOrder(qc, userId);
        },
    });
};

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
