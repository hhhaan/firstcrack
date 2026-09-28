import { orderKeys } from '@shared/lib/query-keys';
import { shouldPrefetchNextPage } from '@shared/lib/shouldPrefetchNextPage';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderInsert, OrderLineInsert, OrderPageParams } from './api';
import { orderApi } from './api';

export { orderKeys };

/** Keys invalidated after create order (staleTime Infinity → must not omit). */
export const invalidateAfterCreateOrder = (qc: QueryClient, userId: string) => {
    void qc.invalidateQueries({ queryKey: orderKeys.all(userId) });
    void qc.invalidateQueries({ queryKey: orderKeys.requirements(userId) });
};

export const useOrdersPaginated = (params: OrderPageParams) => {
    const enabled = !!params.userId;
    const pageKey = (page: number) =>
        orderKeys.paginated(params.userId, {
            page,
            pageSize: params.pageSize,
            status: params.status,
            platform: params.platform,
            search: params.search,
            fromYM: params.fromYM,
            toYM: params.toYM,
        });
    const query = useQuery({
        queryKey: pageKey(params.page),
        queryFn: () => orderApi.listPaginated(params),
        enabled,
        // Page N stays on screen while page N+1 loads, instead of flashing the skeleton.
        placeholderData: (prev) => prev,
    });
    const nextPage = params.page + 1;
    // Active subscribe (not prefetchQuery) so default invalidateQueries refreshes N+1 too.
    useQuery({
        queryKey: pageKey(nextPage),
        queryFn: () => orderApi.listPaginated({ ...params, page: nextPage }),
        enabled: shouldPrefetchNextPage({
            enabled,
            page: params.page,
            pageSize: params.pageSize,
            total: query.data?.total,
            isSuccess: query.isSuccess,
            isPlaceholderData: query.isPlaceholderData,
        }),
    });
    return query;
};

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
        // create() resolves after a committed order even when the follow-up read failed,
        // so the list still refreshes and the mutation is not reported as a failed save.
        onSuccess: () => {
            invalidateAfterCreateOrder(qc, userId);
        },
    });
};
