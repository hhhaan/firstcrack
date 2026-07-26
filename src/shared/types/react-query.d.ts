import '@tanstack/react-query';

declare module '@tanstack/react-query' {
    interface MutationMeta {
        /**
         * Mutation already renders its own inline error UI — suppress the global
         * toast raised by `MutationCache.onError` so the user is told once.
         */
        silentError?: boolean;
    }
}
