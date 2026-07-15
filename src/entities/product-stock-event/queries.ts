import { useQuery } from '@tanstack/react-query';
import { productStockEventApi } from './api';

export const productStockKeys = {
    byUser: (userId: string) => ['product-stock', userId] as const,
};

export const useProductStock = (userId: string) =>
    useQuery({
        queryKey: productStockKeys.byUser(userId),
        queryFn: () => productStockEventApi.getStockByUser(userId),
        enabled: !!userId,
    });
