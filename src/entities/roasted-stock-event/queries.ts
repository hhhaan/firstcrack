import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { useQuery } from '@tanstack/react-query';
import { roastedStockEventApi } from './api';

export const roastedStockKeys = {
    byUser: (userId: string) => [...inventoryQueryRoots.roastedStock, userId] as const,
};

export const useRoastedStock = (userId: string, enabled = true) =>
    useQuery({
        queryKey: roastedStockKeys.byUser(userId),
        queryFn: () => roastedStockEventApi.getUserRoastedStock(userId),
        enabled: !!userId && enabled,
    });
