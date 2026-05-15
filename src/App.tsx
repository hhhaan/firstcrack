import { useState, useEffect, useRef } from 'react';
import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import { supabase } from '@shared/lib/supabase';
import './App.css';
import { Sidebar } from './widgets/sidebar/ui/Sidebar';
import { SettingsModal, type SettingsTabId } from './widgets/settings-modal/ui/SettingsModal';
import { Login, LoadingSpinner } from './views/login';
import { Dashboard } from './views/dashboard';
import { ActiveRoast } from './views/active-roast';
import { History } from './views/history';
import { Beans } from './views/bean';
import { Profiles } from './views/profiles';
import { Machines } from './views/machines';
import { type View } from './shared/types/view';
import { useAuthStore } from './shared/store/auth';
import { ViewErrorBoundary } from './shared/ui/ErrorBoundary';

export const App = () => {
    const user = useAuthStore((s) => s.user);
    const loading = useAuthStore((s) => s.loading);
    const init = useAuthStore((s) => s.init);

    useEffect(() => init(), [init]);

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
            supabase.auth.exchangeCodeForSession(code)
                .then(({ error }) => { if (error) console.error('[auth] dev exchangeCode failed:', error); });
        } else if (accessToken && refreshToken) {
            window.history.replaceState({}, '', '/');
            supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
                .then(({ error }) => { if (error) console.error('[auth] dev setSession failed:', error); });
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
                const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
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
        }).then((fn) => { unlisten = fn; });

        return () => unlisten?.();
    }, []);
    const [view, setView] = useState<View>('dashboard');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>('general');

    const openSettings = (tab: SettingsTabId = 'general') => {
        setSettingsInitialTab(tab);
        setSettingsOpen(true);
    };

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
                <LoadingSpinner />
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
                onOpenSettings={() => openSettings()}
            />
            <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-surface)' }}>
                {view === 'dashboard' && (
                    <ViewErrorBoundary>
                        <Dashboard onNavigate={setView} />
                    </ViewErrorBoundary>
                )}
                {/* 탭 전환 후 복귀해도 타이머·sidecar 폴링이 유지되도록 unmount 대신 CSS hide 사용
            TODO: 로스트 상태를 전역 store(Zustand 등)로 올리면 여러 뷰에서 로스트 진행 상황 접근 가능 */}
                <div style={{ display: view === 'roast' ? 'block' : 'none' }}>
                    <ViewErrorBoundary>
                        <ActiveRoast isActive={view === 'roast'} onOpenRoastSettings={() => openSettings('roast')} />
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
            </div>
            <SettingsModal open={settingsOpen} initialTab={settingsInitialTab} onClose={() => setSettingsOpen(false)} />
        </div>
    );
};
