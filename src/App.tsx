import * as Sentry from '@sentry/react';
import { logger } from '@shared/lib/logger';
import { supabase } from '@shared/lib/supabase';
import { useCallback, useEffect, useState } from 'react';
import { useRoastingStore } from './features/active-roast';
import { useOAuthDeepLink } from './features/auth';
import { useRoastSessionStore } from './shared/store/roastSession';
import type { PlanBatchHandoff } from './shared/types/database.types';
import './App.css';
import { Spinner } from '@shared/ui/Spinner';
import { useTranslation } from 'react-i18next';
import { useInventoryAlertSync } from './features/inventory-alert';
import { useSidecarDeadListener } from './features/sidecar';
import { useUpdateChecker } from './features/updater';
import { useAuthStore } from './shared/store/auth';
import { useThemeStore } from './shared/store/theme';
import type { View } from './shared/types/view';
import { ViewErrorBoundary } from './shared/ui/ErrorBoundary';
import { ActiveRoast } from './views/active-roast/ActiveRoast';
import { Beans } from './views/bean/Beans';
import { Dashboard } from './views/dashboard/Dashboard';
import { History } from './views/history/History';
import { Login } from './views/login/Login';
import { Machines } from './views/machines/Machines';
import { Profiles } from './views/profiles/Profiles';
import { Schedule } from './views/schedule/Schedule';
// import { BottomToolbar } from './widgets/bottom-toolbar';
import { InventoryAlertBanner } from './widgets/inventory-alert-banner';
import { SettingsModal, type SettingsTabId } from './widgets/settings-modal/ui/SettingsModal';
import { Sidebar } from './widgets/sidebar/ui/Sidebar';
import { ThemeSelectModal } from './widgets/theme-select-modal/ui/ThemeSelectModal';

export const App = () => {
    const user = useAuthStore((s) => s.user);
    useInventoryAlertSync(user?.id);
    const loading = useAuthStore((s) => s.loading);
    const oauthPending = useAuthStore((s) => s.oauthPending);
    const cancelOAuth = useAuthStore((s) => s.cancelOAuth);
    const init = useAuthStore((s) => s.init);
    const theme = useThemeStore((s) => s.theme);
    const initTheme = useThemeStore((s) => s.initTheme);

    useEffect(() => init(), [init]);
    useEffect(() => initTheme(), [initTheme]);
    useOAuthDeepLink();

    // Auto-updater: silent background download → system notification
    const { t } = useTranslation();
    const { state, checkAndDownload, applyAndRelaunch } = useUpdateChecker();
    const { isDead: isSidecarDead } = useSidecarDeadListener();

    // 로스팅 진행 중에는 재시작 버튼을 숨긴다 — 즉시 relaunch 시 라이브 세션이 소실되므로.
    // 다운로드는 백그라운드에서 이미 완료되어, 로스팅 종료 후 앱을 다시 열면 자동 반영된다.
    const roastPhase = useRoastingStore((s) => s.phase);
    const isRoastIdle = roastPhase === 'idle';

    useEffect(() => {
        checkAndDownload();
        const id = setInterval(checkAndDownload, 4 * 60 * 60 * 1000);
        return () => clearInterval(id);
    }, [checkAndDownload]);

    // dev mode: Google OAuth 콜백 처리 (PKCE: ?code= / implicit: #access_token=)
    useEffect(() => {
        if (!import.meta.env.DEV) return;

        const search = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.slice(1));

        const code = search.get('code');
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');

        if (code) {
            window.history.replaceState({}, '', '/');
            supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
                if (error) logger.error('[auth] dev exchangeCode failed:', error);
            });
        } else if (accessToken && refreshToken) {
            window.history.replaceState({}, '', '/');
            supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
                if (error) logger.error('[auth] dev setSession failed:', error);
            });
        }
    }, []);

    const [view, setView] = useState<View>('dashboard');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>('general');
    const startBatch = useRoastSessionStore((s) => s.startBatch);
    const completeBatch = useRoastSessionStore((s) => s.completeBatch);

    const openSettings = (tab: SettingsTabId = 'general') => {
        setSettingsInitialTab(tab);
        setSettingsOpen(true);
    };

    const handleStartBatch = useCallback(
        (handoff: PlanBatchHandoff) => {
            startBatch(handoff);
            setView('roast');
        },
        [startBatch],
    );

    const handlePlanBatchComplete = useCallback(() => {
        completeBatch();
        setView('schedule');
    }, [completeBatch]);

    if (loading || oauthPending)
        return (
            <div
                style={{
                    display: 'flex',
                    height: '100vh',
                    flexDirection: 'column',
                    gap: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--color-surface)',
                }}
            >
                <Spinner size={24} />
                {oauthPending && (
                    <>
                        <p style={{ fontSize: 13, color: 'var(--color-secondary)', letterSpacing: '0.14px' }}>
                            Completing sign-in…
                        </p>
                        <button
                            type="button"
                            onClick={() => cancelOAuth()}
                            style={{
                                marginTop: 4,
                                padding: '8px 16px',
                                borderRadius: 9999,
                                border: 'none',
                                background: 'var(--bg-warm)',
                                color: 'var(--color-primary)',
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: 'pointer',
                                letterSpacing: '0.14px',
                                fontFamily: 'var(--font-body)',
                            }}
                        >
                            Cancel
                        </button>
                    </>
                )}
            </div>
        );
    if (!user) return <Login />;

    const sentryFallback = ({ error, resetError }: { error: unknown; resetError: () => void }) => (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center bg-[var(--color-surface)]">
            <p className="text-sm text-red-400">
                {error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}
            </p>
            <button
                type="button"
                onClick={resetError}
                className="px-4 py-2 text-sm rounded-md bg-stone-700 hover:bg-stone-600 text-stone-100 transition-colors"
            >
                다시 시도
            </button>
        </div>
    );

    return (
        <Sentry.ErrorBoundary fallback={sentryFallback}>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100vh',
                    overflow: 'hidden',
                }}
            >
                {theme === null && <ThemeSelectModal />}
                <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <Sidebar
                        activeView={view}
                        onNavigate={setView}
                        collapsed={sidebarCollapsed}
                        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
                        onOpenSettings={(tab) => openSettings(tab as SettingsTabId)}
                    />
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: view === 'roast' ? 'hidden' : 'auto',
                            background: 'var(--color-surface)',
                        }}
                    >
                        <InventoryAlertBanner userId={user.id} onNavigate={setView} />
                        {view === 'dashboard' && (
                            <ViewErrorBoundary>
                                <Dashboard onNavigate={setView} />
                            </ViewErrorBoundary>
                        )}
                        {/* 탭 전환 후 복귀해도 타이머·sidecar 폴링이 유지되도록 unmount 대신 CSS hide 사용
            TODO: 로스트 상태를 전역 store(Zustand 등)로 올리면 여러 뷰에서 로스트 진행 상황 접근 가능 */}
                        <div
                            style={{
                                display: view === 'roast' ? 'flex' : 'none',
                                flexDirection: 'column',
                                flex: view === 'roast' ? 1 : undefined,
                                height: view === 'roast' ? undefined : '100%',
                                minHeight: 0,
                                overflow: 'hidden',
                            }}
                        >
                            <ViewErrorBoundary>
                                <ActiveRoast
                                    isActive={view === 'roast'}
                                    onOpenRoastSettings={() => openSettings('roast')}
                                    onPlanBatchComplete={handlePlanBatchComplete}
                                />
                            </ViewErrorBoundary>
                        </div>
                        {view === 'history' && (
                            <ViewErrorBoundary>
                                <History />
                            </ViewErrorBoundary>
                        )}
                        {view === 'beans' && (
                            <ViewErrorBoundary>
                                <Beans onNavigate={setView} />
                            </ViewErrorBoundary>
                        )}
                        {view === 'profiles' && (
                            <ViewErrorBoundary>
                                <Profiles onNavigate={setView} />
                            </ViewErrorBoundary>
                        )}
                        <div style={{ display: view === 'machines' ? 'block' : 'none' }}>
                            <ViewErrorBoundary>
                                <Machines isActive={view === 'machines'} onNavigate={setView} />
                            </ViewErrorBoundary>
                        </div>
                        {view === 'schedule' && (
                            <ViewErrorBoundary>
                                <Schedule onStartBatch={handleStartBatch} />
                            </ViewErrorBoundary>
                        )}
                    </div>
                </div>
                {/* <BottomToolbar /> */}
                <SettingsModal
                    open={settingsOpen}
                    initialTab={settingsInitialTab}
                    onClose={() => setSettingsOpen(false)}
                />

                {isSidecarDead && (
                    <div className="fixed bottom-6 left-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-lg bg-red-900/90 border border-red-700 text-red-100 text-sm shadow-lg">
                        <span>{t('updater.sidecarDead')}</span>
                        <span className="text-red-300">{t('updater.sidecarDeadRestart')}</span>
                    </div>
                )}

                {state.status === 'ready' && isRoastIdle && (
                    <button
                        type="button"
                        onClick={() => void applyAndRelaunch()}
                        style={{
                            position: 'fixed',
                            bottom: 24,
                            right: 24,
                            zIndex: 9999,
                            padding: '10px 20px',
                            borderRadius: 9999,
                            border: 'none',
                            background: 'var(--color-accent, #2563eb)',
                            color: '#fff',
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: 'pointer',
                            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                        }}
                    >
                        {t('updater.ready', { version: state.version })}
                    </button>
                )}

                {state.status === 'applying' && (
                    <div
                        style={{
                            position: 'fixed',
                            bottom: 24,
                            right: 24,
                            zIndex: 9999,
                            padding: '10px 20px',
                            borderRadius: 9999,
                            background: 'var(--color-accent, #2563eb)',
                            color: '#fff',
                            fontSize: 14,
                            fontWeight: 500,
                            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                        }}
                    >
                        {t('updater.applying')}
                    </div>
                )}

                {state.status === 'error' && state.error && (
                    <div className="fixed bottom-6 right-6 z-[9999] max-w-sm px-4 py-3 rounded-lg bg-red-900/90 border border-red-700 text-red-100 text-sm shadow-lg">
                        {t(state.error ?? '')}
                    </div>
                )}
            </div>
        </Sentry.ErrorBoundary>
    );
};
