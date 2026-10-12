// Sentry 초기화는 이 모듈 import의 side effect다 — App보다 먼저 평가되어야 한다.
import { createAppQueryClient } from '@shared/lib/createAppQueryClient';
import { logger } from '@shared/lib/logger';
import { captureActionable, reactRootOptions } from '@shared/lib/sentry';
import { isSupabaseConfigured, MISSING_SUPABASE_ENV } from '@shared/lib/supabase';
import { flushTsv } from '@shared/lib/tsv-writer';
import { QueryClientProvider } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { ask } from '@tauri-apps/plugin-dialog';
import { exit } from '@tauri-apps/plugin-process';
import i18n from 'i18next';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useRoastingStore } from './features/active-roast/model/status';
import { initI18n } from './shared/i18n';
import { bindAuthQueryClient } from './shared/store/auth';
import { ToastViewport } from './shared/ui/ToastViewport';
import 'uplot/dist/uPlot.min.css';

const queryClient = createAppQueryClient();
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
