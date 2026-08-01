import * as Sentry from '@sentry/react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initI18n } from './shared/i18n';
import { logger } from './shared/lib/logger';
import { showMutationErrorToast } from './shared/lib/mutationErrorToast';
import { ToastViewport } from './shared/ui/ToastViewport';
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
    mutationCache: new MutationCache({
        onError: (error, _variables, _onMutateResult, mutation) => {
            onQueryError(error);
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
            // 4xx는 재시도 의미 없음 (인증/권한 문제) — 서버 오류(5xx)만 최대 2회 재시도
            retry: (failureCount, error) => !is4xx(error) && failureCount < 2,
        },
    },
});

// DSN은 클라이언트 공개값 (Rust/사이드카도 동일하게 하드코딩) — 빌드 시크릿 의존 제거
const SENTRY_DSN = 'https://a7ad70395dfd0d01e1a94e04fdf4e0e1@o4511400846884864.ingest.us.sentry.io/4511400857042944';

if (import.meta.env.PROD) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: 'production',
        release: __APP_VERSION__,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.1,
    });
}

const bootstrap = async () => {
    await initI18n();

    if (import.meta.env.VITE_E2E === '1' || import.meta.env.VITE_E2E === 'true') {
        const { installE2eBridge } = await import('./shared/lib/e2e-bridge');
        installE2eBridge();
    }

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <App />
                <ToastViewport />
            </QueryClientProvider>
        </React.StrictMode>,
    );
};

void bootstrap();
