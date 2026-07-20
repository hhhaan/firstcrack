import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { roastedStockEventApi } from './api';

export const roastedStockKeys = {
    root: inventoryQueryRoots.roastedStock,
    byUser: (userId: string) => [...inventoryQueryRoots.roastedStock, userId] as const,
    events: (userId: string) => [...inventoryQueryRoots.roastedStock, 'events', userId] as const,
};

/** Cache-first roasted bulk stock; fetches once if missing. */
export const ensureRoastedStock = (qc: QueryClient, userId: string) =>
    qc.ensureQueryData({
        queryKey: roastedStockKeys.byUser(userId),
        queryFn: () => roastedStockEventApi.getUserRoastedStock(userId),
    });

export const useRoastedStock = (userId: string, enabled = true) =>
    useQuery({
        queryKey: roastedStockKeys.byUser(userId),
        queryFn: () => roastedStockEventApi.getUserRoastedStock(userId),
        enabled: !!userId && enabled,
    });

export const useRoastedStockEvents = (userId: string, enabled = true) =>
    useQuery({
        queryKey: roastedStockKeys.events(userId),
        queryFn: () => roastedStockEventApi.listByUser(userId, 200),
        enabled: !!userId && enabled,
    });
