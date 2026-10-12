import '@tanstack/react-query';

declare module '@tanstack/react-query' {
    interface QueryMeta {
        /** Sentry tag. Fixed code only — never a path, host, or user text. */
        feature?: string;
        rpc?: string;
        table?: string;
    }

    interface MutationMeta {
        /**
         * Mutation already renders its own inline error UI — suppress the global
         * toast raised by `MutationCache.onError` so the user is told once.
         */
        silentError?: boolean;
        /** Sentry tag. Fixed code only — never a path, host, or user text. */
        feature?: string;
        rpc?: string;
        table?: string;
    }
}
