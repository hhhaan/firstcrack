import { logger } from '@shared/lib/logger';
// Sentry 초기화는 이 모듈 import의 side effect다 — App보다 먼저 평가되어야 한다.
import {
    captureActionable,
    reactRootOptions,
    reportReactQueryError,
    retryUnlessClientRefusal,
} from '@shared/lib/sentry';
import { isSupabaseConfigured, MISSING_SUPABASE_ENV } from '@shared/lib/supabase';
import { flushTsv } from '@shared/lib/tsv-writer';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { ask } from '@tauri-apps/plugin-dialog';
import { exit } from '@tauri-apps/plugin-process';
import i18n from 'i18next';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useRoastingStore } from './features/active-roast/model/status';
import { initI18n } from './shared/i18n';
import { showMutationErrorToast } from './shared/lib/mutationErrorToast';
import { bindAuthQueryClient } from './shared/store/auth';
import { ToastViewport } from './shared/ui/ToastViewport';
import 'uplot/dist/uPlot.min.css';

// silentError(meta)는 토스트 표시 정책일 뿐이다 — Sentry 전송 여부와 연결하지 않는다.
const onQueryError = reportReactQueryError;

const queryClient = new QueryClient({
    queryCache: new QueryCache({
        onError: (error, query) => onQueryError(error, query.meta as Record<string, unknown>),
    }),
    mutationCache: new MutationCache({
        onError: (error, _variables, _onMutateResult, mutation) => {
            onQueryError(error, mutation.meta as Record<string, unknown>);
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
bindAuthQueryClient(queryClient);

const bootstrap = async () => {
    await initI18n();

    if ('__TAURI_INTERNALS__' in window) {
        let quitPending = false;
        try {
            const handleQuitRequest = async () => {
                if (quitPending) return;
                quitPending = true;
                try {
                    if (useRoastingStore.getState().phase === 'roasting') {
                        const confirmed = await ask(i18n.t('common.quitConfirmMessage'), {
                            title: i18n.t('common.quitConfirmTitle'),
                            kind: 'warning',
                            okLabel: i18n.t('common.quit'),
                            cancelLabel: i18n.t('common.cancel'),
                        });
                        if (!confirmed) return;
                    }
                    try {
                        await flushTsv();
                    } catch (error) {
                        logger.capture(error, { scope: 'quit.flushTsv' });
                    }
                    await exit(0);
                } catch (error) {
                    logger.capture(error, { scope: 'quit' });
                } finally {
                    quitPending = false;
                }
            };
            await listen('quit-requested', () => {
                void handleQuitRequest();
            });
        } catch (error) {
            logger.capture(error, { scope: 'quit.listen' });
        }
    }

    const root = ReactDOM.createRoot(
        document.getElementById('root') as HTMLElement,
        // Sentry 비활성 시 undefined — React 기본 콘솔 리포팅을 그대로 둔다.
        // 활성 시에는 커스텀 핸들러가 콘솔 출력을 대체하므로 DEV 스모크에서 직접 찍어준다.
        reactRootOptions((error) => logger.error('[react] handled error', error)),
    );

    if (!isSupabaseConfigured) {
        captureActionable(new Error(MISSING_SUPABASE_ENV));
        root.render(
            <React.StrictMode>
                <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center bg-[var(--color-surface)]">
                    <p className="text-sm text-red-400">{MISSING_SUPABASE_ENV}</p>
                </div>
            </React.StrictMode>,
        );
        return;
    }

    if (import.meta.env.VITE_E2E === '1' || import.meta.env.VITE_E2E === 'true') {
        const { installE2eBridge } = await import('./features/active-roast/lib/e2e-bridge');
        installE2eBridge();
    }

    root.render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <App />
                <ToastViewport />
            </QueryClientProvider>
        </React.StrictMode>,
    );
};

void bootstrap();
