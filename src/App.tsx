import * as Sentry from '@sentry/react';
import { supabase } from '@shared/lib/supabase';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoastSessionStore } from './shared/store/roastSession';
import type { PlanBatchHandoff } from './shared/types/database.types';
import './App.css';
import { Spinner } from '@shared/ui/Spinner';
import { useSidecarDeadListener } from './features/sidecar';
import { useUpdateChecker } from './features/updater';
import { useAuthStore } from './shared/store/auth';
import { useThemeStore } from './shared/store/theme';
import type { View } from './shared/types/view';
import { ViewErrorBoundary } from './shared/ui/ErrorBoundary';
import { ActiveRoast } from './views/active-roast';
import { Beans } from './views/bean';
import { Dashboard } from './views/dashboard';
import { History } from './views/history';
import { Login } from './views/login';
import { Machines } from './views/machines';
import { Profiles } from './views/profiles';
import { Schedule } from './views/schedule';
import { SettingsModal, type SettingsTabId } from './widgets/settings-modal/ui/SettingsModal';
import { Sidebar } from './widgets/sidebar/ui/Sidebar';
import { ThemeSelectModal } from './widgets/theme-select-modal/ui/ThemeSelectModal';

export const App = () => {
    const user = useAuthStore((s) => s.user);
    const loading = useAuthStore((s) => s.loading);
    const init = useAuthStore((s) => s.init);
    const theme = useThemeStore((s) => s.theme);
    const initTheme = useThemeStore((s) => s.initTheme);

    useEffect(() => init(), [init]);
    useEffect(() => initTheme(), [initTheme]);

    // Auto-updater: silent background download → system notification
    const { state, checkAndDownload, applyAndRelaunch } = useUpdateChecker();
    const { isDead: isSidecarDead } = useSidecarDeadListener();

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
                if (error) console.error('[auth] dev exchangeCode failed:', error);
            });
        } else if (accessToken && refreshToken) {
            window.history.replaceState({}, '', '/');
            supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
                if (error) console.error('[auth] dev setSession failed:', error);
            });
        }
    }, []);

    const handledRef = useRef(false);
    useEffect(() => {
        const handleCallback = async (url: string) => {
            console.log('[deep-link] received:', url);
            if (!url.includes('auth/callback') || handledRef.current) return;
            handledRef.current = true;

            const parsed = new URL(url);
            const code = parsed.searchParams.get('code');

            if (code) {
                console.log('[deep-link] exchanging PKCE code...');
                const { error } = await supabase.auth.exchangeCodeForSession(code);
                if (error) console.error('[deep-link] exchangeCodeForSession failed:', error);
                else console.log('[deep-link] session exchanged successfully');
                return;
            }

            // implicit flow 폴백: #access_token=...&refresh_token=...
            const hash = new URLSearchParams(parsed.hash.slice(1));
            const accessToken = hash.get('access_token');
            const refreshToken = hash.get('refresh_token');
            if (accessToken && refreshToken) {
                console.log('[deep-link] setting session from hash tokens...');
                const { error } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                });
                if (error) console.error('[deep-link] setSession failed:', error);
                else console.log('[deep-link] session set successfully');
            }
        };

        getCurrent().then((urls) => {
            console.log('[deep-link] getCurrent:', urls);
            if (urls?.length) handleCallback(urls[0]);
        });

        let unlisten: (() => void) | undefined;
        onOpenUrl((urls) => {
            console.log('[deep-link] onOpenUrl:', urls);
            if (urls.length) handleCallback(urls[0]);
        }).then((fn) => {
            unlisten = fn;
        });

        return () => unlisten?.();
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

    if (loading)
        return (
            <div
                style={{
                    display: 'flex',
                    height: '100vh',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--color-surface)',
                }}
            >
                <Spinner size={24} />
            </div>
        );
    if (!user) return <Login />;

    const sentryFallback = ({ error, resetError }: { error: unknown; resetError: () => void }) => (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center bg-[var(--color-surface)]">
            <p className="text-sm text-red-400">
                {error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}
            </p>
            <button
                onClick={resetError}
                className="px-4 py-2 text-sm rounded-md bg-stone-700 hover:bg-stone-600 text-stone-100 transition-colors"
            >
                다시 시도
            </button>
        </div>
    );

    return (
        <Sentry.ErrorBoundary fallback={sentryFallback}>
            <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
                {theme === null && <ThemeSelectModal />}
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
                <SettingsModal
                    open={settingsOpen}
                    initialTab={settingsInitialTab}
                    onClose={() => setSettingsOpen(false)}
                />

                {isSidecarDead && (
                    <div className="fixed bottom-6 left-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-lg bg-red-900/90 border border-red-700 text-red-100 text-sm shadow-lg">
                        <span>하드웨어 연결 서비스가 응답하지 않습니다.</span>
                        <span className="text-red-300">앱을 재시작해 주세요.</span>
                    </div>
                )}

                {state.status === 'ready' && (
                    <button
                        onClick={applyAndRelaunch}
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
                        새 업데이트 (v{state.version}) 재시작
                    </button>
                )}
            </div>
        </Sentry.ErrorBoundary>
    );
};
