import { productStockKeys } from '@shared/lib/query-keys';
import { useQuery } from '@tanstack/react-query';
import { productStockEventApi } from './api';

export { productStockKeys };

export const useProductStock = (userId: string) =>
    useQuery({
        queryKey: productStockKeys.byUser(userId),
        queryFn: () => productStockEventApi.getStockByUser(userId),
        enabled: !!userId,
    });

export const useProductStockEvents = (userId: string, productId: string, enabled = true) =>
    useQuery({
        queryKey: productStockKeys.events(userId, productId),
        queryFn: () => productStockEventApi.listByProduct(productId),
        enabled: !!userId && !!productId && enabled,
    });
