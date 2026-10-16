import { roastedStockKeys } from '@shared/lib/query-keys';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { roastedStockEventApi } from './api';

export { roastedStockKeys };

const roastedStockByUserQuery = (userId: string) => ({
    queryKey: roastedStockKeys.byUser(userId),
    queryFn: () => roastedStockEventApi.getUserRoastedStock(userId),
});

/** Cache-first roasted bulk stock; fetches once if missing. */
export const ensureRoastedStock = (qc: QueryClient, userId: string) =>
    qc.ensureQueryData(roastedStockByUserQuery(userId));

/** Warm the roasted-stock cache without subscribing. Same key as `useRoastedStock`. */
export const prefetchRoastedStock = (qc: QueryClient, userId: string) =>
    qc.prefetchQuery(roastedStockByUserQuery(userId));

export const useRoastedStock = (userId: string, enabled = true) =>
    useQuery({
        ...roastedStockByUserQuery(userId),
        enabled: !!userId && enabled,
    });

export const useRoastedStockEvents = (userId: string, enabled = true) =>
    useQuery({
        queryKey: roastedStockKeys.events(userId),
        queryFn: () => roastedStockEventApi.listByUser(userId, 200),
        enabled: !!userId && enabled,
    });
