import * as Sentry from '@sentry/react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initI18n } from './shared/i18n';
import { logger } from './shared/lib/logger';
import 'uplot/dist/uPlot.min.css';

const is4xx = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    const status =
        (error as Record<string, unknown>).status ?? (error as { response?: { status?: unknown } }).response?.status;
    return typeof status === 'number' && status >= 400 && status < 500;
};

const onQueryError = (error: Error) => {
    if (import.meta.env.PROD) logger.capture(error);
};

const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onQueryError }),
    mutationCache: new MutationCache({ onError: onQueryError }),
    defaultOptions: {
        queries: {
            staleTime: Infinity,
            refetchOnWindowFocus: false,
            // 4xx는 재시도 의미 없음 (인증/권한 문제) — 서버 오류(5xx)만 최대 2회 재시도
            retry: (failureCount, error) => !is4xx(error) && failureCount < 2,
        },
    },
});

if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: 'production',
        release: __APP_VERSION__,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.1,
    });
}

const bootstrap = async () => {
    await initI18n();

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        </React.StrictMode>,
    );
};

void bootstrap();
