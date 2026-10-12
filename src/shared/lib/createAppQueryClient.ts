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
                staleTime: Infinity,
                gcTime: Infinity,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                retry: retryUnlessClientRefusal,
            },
        },
    });
