import { productStockKeys } from '@shared/lib/query-keys';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { productStockEventApi } from './api';

export { productStockKeys };

const productStockByUserQuery = (userId: string) => ({
    queryKey: productStockKeys.byUser(userId),
    queryFn: () => productStockEventApi.getStockByUser(userId),
});

/** Warm the product-stock cache without subscribing. Same key as `useProductStock`. */
export const prefetchProductStock = (qc: QueryClient, userId: string) =>
    qc.prefetchQuery(productStockByUserQuery(userId));

export const useProductStock = (userId: string) =>
    useQuery({
        ...productStockByUserQuery(userId),
        enabled: !!userId,
    });

export const useProductStockEvents = (userId: string, productId: string, enabled = true) =>
    useQuery({
        queryKey: productStockKeys.events(userId, productId),
        queryFn: () => productStockEventApi.listByProduct(productId),
        enabled: !!userId && !!productId && enabled,
    });
