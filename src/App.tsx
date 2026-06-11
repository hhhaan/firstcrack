import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoastSessionStore } from './shared/store/roastSession';
import { type PlanBatchHandoff } from './shared/types/database.types';
import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { confirm } from '@tauri-apps/plugin-dialog';
import { supabase } from '@shared/lib/supabase';
import './App.css';
import { Sidebar } from './widgets/sidebar/ui/Sidebar';
import { SettingsModal, type SettingsTabId } from './widgets/settings-modal/ui/SettingsModal';
import { Login } from './views/login';
import { Spinner } from '@shared/ui/Spinner';
import { Dashboard } from './views/dashboard';
import { ActiveRoast } from './views/active-roast';
import { History } from './views/history';
import { Beans } from './views/bean';
import { Profiles } from './views/profiles';
import { Machines } from './views/machines';
import { Schedule } from './views/schedule';
import { type View } from './shared/types/view';
import { useAuthStore } from './shared/store/auth';
import { ViewErrorBoundary } from './shared/ui/ErrorBoundary';

export const App = () => {
    const user = useAuthStore((s) => s.user);
    const loading = useAuthStore((s) => s.loading);
    const init = useAuthStore((s) => s.init);

    useEffect(() => init(), [init]);

    // Auto-updater: check for updates on startup
    useEffect(() => {
        const checkForUpdates = async () => {
            if (import.meta.env.DEV) return;

            try {
                const update = await check();
                if (update) {
                    console.log(`[updater] new version found: ${update.version}`);
                    const confirmed = await confirm(
                        `새로운 버전(${update.version})이 준비되었습니다. 지금 업데이트하고 다시 시작할까요?`,
                        { title: '업데이트 알림', kind: 'info' }
                    );

                    if (confirmed) {
                        await update.downloadAndInstall();
                        await relaunch();
                    }
                }
            } catch (error) {
                console.error('[updater] failed to check for updates:', error);
            }
        };

        checkForUpdates();
    }, []);

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

    const handleStartBatch = useCallback((handoff: PlanBatchHandoff) => {
        startBatch(handoff);
        setView('roast');
    }, [startBatch]);

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

    return (
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
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
            <SettingsModal open={settingsOpen} initialTab={settingsInitialTab} onClose={() => setSettingsOpen(false)} />
        </div>
    );
};
