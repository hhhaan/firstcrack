import { SIDECAR_BASE } from '@shared/lib/sidecar';
import { useQuery } from '@tanstack/react-query';

const FUTURES_TTL = 30 * 60 * 1000;

export interface CoffeeFuturesData {
    price: number;
    previousClose: number;
}

const fetchCoffeeFutures = async (): Promise<CoffeeFuturesData> => {
    const res = await fetch(`${SIDECAR_BASE}/coffee-futures`);
    if (!res.ok) throw new Error('coffee futures fetch failed');
    const data = await res.json();
    if (typeof data.price !== 'number' || typeof data.previousClose !== 'number') {
        throw new Error('invalid coffee futures response');
    }
    return data;
};

export const useCoffeeFutures = () => {
    const { data, isLoading, isFetching, refetch } = useQuery({
        queryKey: ['coffee-futures'],
        queryFn: fetchCoffeeFutures,
        staleTime: FUTURES_TTL,
        retry: 1,
    });

    return {
        data: data ?? null,
        loading: isLoading,
        refreshing: isFetching,
        refetch,
    };
};
