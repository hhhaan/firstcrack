import { logger } from '@shared/lib/logger';
// Sentry 초기화는 이 모듈 import의 side effect다 — App보다 먼저 평가되어야 한다.
import { captureActionable, isClientRefusal, reactRootOptions } from '@shared/lib/sentry';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initI18n } from './shared/i18n';
import { showMutationErrorToast } from './shared/lib/mutationErrorToast';
import { bindAuthQueryClient } from './shared/store/auth';
import { ToastViewport } from './shared/ui/ToastViewport';
import 'uplot/dist/uPlot.min.css';

const is4xx = isClientRefusal;

// silentError(meta)는 토스트 표시 정책일 뿐이다 — Sentry 전송 여부와 연결하지 않는다.
const onQueryError = (error: Error) => captureActionable(error);

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
bindAuthQueryClient(queryClient);

const bootstrap = async () => {
    await initI18n();

    if (import.meta.env.VITE_E2E === '1' || import.meta.env.VITE_E2E === 'true') {
        const { installE2eBridge } = await import('./features/active-roast/lib/e2e-bridge');
        installE2eBridge();
    }

    ReactDOM.createRoot(
        document.getElementById('root') as HTMLElement,
        // Sentry 비활성 시 undefined — React 기본 콘솔 리포팅을 그대로 둔다.
        // 활성 시에는 커스텀 핸들러가 콘솔 출력을 대체하므로 DEV 스모크에서 직접 찍어준다.
        reactRootOptions((error) => logger.error('[react] handled error', error)),
    ).render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <App />
                <ToastViewport />
            </QueryClientProvider>
        </React.StrictMode>,
    );
};

void bootstrap();
