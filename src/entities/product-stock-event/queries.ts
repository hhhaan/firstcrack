import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { productStockEventApi } from './api';

export const productStockKeys = {
    root: inventoryQueryRoots.productStock,
    byUser: (userId: string) => [...inventoryQueryRoots.productStock, userId] as const,
    events: (productId: string) => [...inventoryQueryRoots.productStock, 'events', productId] as const,
};

/** Cache-first product stock; fetches once if missing. */
export const ensureProductStock = (qc: QueryClient, userId: string) =>
    qc.ensureQueryData({
        queryKey: productStockKeys.byUser(userId),
        queryFn: () => productStockEventApi.getStockByUser(userId),
    });

export const useProductStock = (userId: string) =>
    useQuery({
        queryKey: productStockKeys.byUser(userId),
        queryFn: () => productStockEventApi.getStockByUser(userId),
        enabled: !!userId,
    });

export const useProductStockEvents = (productId: string, enabled = true) =>
    useQuery({
        queryKey: productStockKeys.events(productId),
        queryFn: () => productStockEventApi.listByProduct(productId),
        enabled: !!productId && enabled,
    });
