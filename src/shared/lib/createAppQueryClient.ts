import { reportReactQueryError, retryUnlessClientRefusal } from '@shared/lib/sentry';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { showMutationErrorToast } from './mutationErrorToast';

/** React Query client used by main.tsx — cache onError wiring is the production Sentry path. */
export const createAppQueryClient = () =>
    new QueryClient({
        queryCache: new QueryCache({
            onError: (error, query) => reportReactQueryError(error, query.meta as Record<string, unknown>),
        }),
        mutationCache: new MutationCache({
            onError: (error, _variables, _onMutateResult, mutation) => {
                reportReactQueryError(error, mutation.meta as Record<string, unknown>);
                showMutationErrorToast(error, mutation.meta);
            },
        }),
        defaultOptions: {
            queries: {
                // Desktop: mutation invalidation only — no background refetch churn.
                staleTime: Infinity,
                // Keep unused inventory/lists after tab switch (default 5m GC was too aggressive).
                gcTime: Infinity,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                // 4xx·결정적 PostgREST(42703 등, status 없어도)는 재시도하지 않는다. 네트워크·5xx만 최대 2회.
                retry: retryUnlessClientRefusal,
            },
        },
    });
