import { logger } from '@shared/lib/logger';
import { setSentryIdentity } from '@shared/lib/sentry';
import { supabase } from '@shared/lib/supabase';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoastingStore } from './features/active-roast';
import { useOAuthDeepLink } from './features/auth';
import type { PlanBatchHandoff } from './shared/types/database.types';
import './App.css';
import { Spinner } from '@shared/ui/Spinner';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { useActiveWorkspace } from './entities/organization';
import { useSidecarDeadListener } from './features/sidecar';
import { useUpdateChecker } from './features/updater';
import { useAuthStore } from './shared/store/auth';
import {
    SHORTCUT_HOTKEY_OPTIONS,
    shortcutHotkeys,
    useShortcutKeys,
    useShortcutStore,
} from './shared/store/keyboard-shortcuts';
import { useThemeStore } from './shared/store/theme';
import type { View } from './shared/types/view';
import { ErrorBoundary, ViewErrorBoundary } from './shared/ui/ErrorBoundary';
import { ActiveRoast } from './views/active-roast/ActiveRoast';
import { ActiveRoastRuntime } from './views/active-roast/ActiveRoastRuntime';
import { Beans } from './views/bean/Beans';
import { Cupping } from './views/cupping/Cupping';
import { Dashboard } from './views/dashboard/Dashboard';
import { History } from './views/history/History';
import { Login } from './views/login/Login';
import { Machines } from './views/machines/Machines';
import { Orders } from './views/orders/Orders';
import { Pricing } from './views/pricing/Pricing';
import { Profiles } from './views/profiles/Profiles';
import { Schedule } from './views/schedule/Schedule';
import { Settings } from './views/settings/Settings';
import { InventoryAlertBanner } from './widgets/inventory-alert-banner';
import { PendingRoastRecovery } from './widgets/pending-roast-recovery';
import { KeyboardShortcutsModal } from './widgets/settings/ui/KeyboardShortcutsModal';
import type { SettingsTabId } from './widgets/settings/ui/tabConfig';
import { Sidebar } from './widgets/sidebar/ui/Sidebar';

// VOC: restore first-run theme picker
// import { ThemeSelectModal } from './widgets/theme-select-modal/ui/ThemeSelectModal';

const COMPARE_PLANS_URL = 'https://firstcrackiscoming.com/compare-plans';

export const App = () => {
    const user = useAuthStore((s) => s.user);
    const { workspaceOwnerId } = useActiveWorkspace();
    const loading = useAuthStore((s) => s.loading);
    const oauthPending = useAuthStore((s) => s.oauthPending);
    const cancelOAuth = useAuthStore((s) => s.cancelOAuth);
    const init = useAuthStore((s) => s.init);
    // VOC: restore first-run theme picker — const theme = useThemeStore((s) => s.theme);
    const initTheme = useThemeStore((s) => s.initTheme);

    useEffect(() => init(), [init]);
    useEffect(() => initTheme(), [initTheme]);
    useOAuthDeepLink();

    // 이슈를 사용자/워크스페이스 단위로 좁힌다 (id만 — 이메일·이름은 보내지 않는다).
    // 로그아웃/워크스페이스 미확정 시 초기화되어 다음 사용자에게 새지 않는다.
    useEffect(() => setSentryIdentity(user?.id, workspaceOwnerId), [user?.id, workspaceOwnerId]);

    // Auto-updater: silent background download → system notification
    const { t } = useTranslation();
    const { state, checkAndDownload, applyAndRelaunch } = useUpdateChecker();
    const { isDead: isSidecarDead } = useSidecarDeadListener();

    // 로스팅 진행 중에는 재시작 버튼을 숨긴다 — 즉시 relaunch 시 라이브 세션이 소실되므로.
    // 다운로드는 백그라운드에서 이미 완료되어, 로스팅 종료 후 앱을 다시 열면 자동 반영된다.
    const roastPhase = useRoastingStore((s) => s.phase);
    const isRoastIdle = roastPhase === 'idle';

    useEffect(() => {
        void checkAndDownload();
        const id = setInterval(
            () => {
                void checkAndDownload();
            },
            4 * 60 * 60 * 1000,
        );
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
            void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
                if (error) logger.error('[auth] dev exchangeCode failed:', error);
            });
        } else if (accessToken && refreshToken) {
            window.history.replaceState({}, '', '/');
            void supabase.auth
                .setSession({ access_token: accessToken, refresh_token: refreshToken })
                .then(({ error }) => {
                    if (error) logger.error('[auth] dev setSession failed:', error);
                });
        }
    }, []);

    const [view, setView] = useState<View>('dashboard');
    const [roastMount, setRoastMount] = useState(0);
    useEffect(() => {
        if (import.meta.env.VITE_E2E !== '1' && import.meta.env.VITE_E2E !== 'true') return;
        const bridge = window.__FC_E2E__;
        if (!bridge) return;
        bridge.remountRoast = () => setRoastMount((n) => n + 1);
    }, []);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
    const settingsReturnView = useRef<View>('dashboard');
    const startBatch = useRoastingStore((s) => s.startBatch);
    const completeBatch = useRoastingStore((s) => s.completeBatch);

    // Active roast: collapse nav for chart real estate (also if user left it open elsewhere)
    useEffect(() => {
        if (view === 'roast') setSidebarCollapsed(true);
    }, [view]);

    const openSettings = (tab: SettingsTabId = 'general') => {
        if (view !== 'settings') settingsReturnView.current = view;
        setSettingsTab(tab);
        setView('settings');
    };

    const settingsKeys = useShortcutKeys('openSettings');
    const shortcutsKeys = useShortcutKeys('openShortcuts');
    const sidebarKeys = useShortcutKeys('toggleSidebar');
    const shortcutsOpen = useShortcutStore((s) => s.dialogOpen);
    const recordingShortcut = useShortcutStore((s) => s.recording);
    const setShortcutsOpen = useShortcutStore((s) => s.setDialogOpen);
    const appKeysEnabled = Boolean(user) && !loading && !oauthPending && !recordingShortcut;
    useHotkeys(shortcutHotkeys(settingsKeys), () => openSettings(), {
        ...SHORTCUT_HOTKEY_OPTIONS,
        enabled: appKeysEnabled && !shortcutsOpen,
        enableOnFormTags: settingsKeys.every((key) => /\b(mod|ctrl|alt)\+/.test(key)),
        preventDefault: true,
    });
    useHotkeys(shortcutHotkeys(shortcutsKeys), () => setShortcutsOpen(true), {
        ...SHORTCUT_HOTKEY_OPTIONS,
        enabled: appKeysEnabled,
        enableOnFormTags: shortcutsKeys.every((key) => /\b(mod|ctrl|alt)\+/.test(key)),
        preventDefault: true,
    });
    useHotkeys(shortcutHotkeys(sidebarKeys), () => setSidebarCollapsed((current) => !current), {
        ...SHORTCUT_HOTKEY_OPTIONS,
        enabled: appKeysEnabled && !shortcutsOpen && view !== 'settings',
        preventDefault: true,
    });
    useHotkeys(
        'escape',
        (event) => {
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            event.preventDefault();
            setView(settingsReturnView.current);
        },
        {
            enabled: appKeysEnabled && view === 'settings' && !shortcutsOpen,
            enableOnFormTags: true,
            enableOnContentEditable: true,
        },
    );

    const openComparePlans = () => {
        void openUrl(COMPARE_PLANS_URL).catch((err) => {
            logger.capture(err, { context: 'open compare plans' });
        });
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

    // 캡처는 하지 않는다 — React 19 root onCaughtError가 유일한 Sentry 경로다 (중복 이슈 방지).
    const appShellFallback = ({ error, reset }: { error: Error; reset: () => void }) => (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center bg-[var(--color-surface)]">
            <p className="text-sm text-red-400">{error.message || '알 수 없는 오류가 발생했습니다.'}</p>
            <button
                type="button"
                onClick={reset}
                className="px-4 py-2 text-sm rounded-md bg-stone-700 hover:bg-stone-600 text-stone-100 transition-colors"
            >
                다시 시도
            </button>
        </div>
    );

    return (
        <ErrorBoundary fallback={appShellFallback}>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100vh',
                    overflow: 'hidden',
                }}
            >
                {/* VOC: restore first-run theme picker — {theme === null && <ThemeSelectModal />} */}
                <PendingRoastRecovery />
                {shortcutsOpen && <KeyboardShortcutsModal />}
                <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {view !== 'settings' && (
                        <Sidebar
                            activeView={view}
                            onNavigate={setView}
                            collapsed={sidebarCollapsed}
                            onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
                            onOpenSettings={(tab) => openSettings(tab as SettingsTabId)}
                        />
                    )}
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            minWidth: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: view === 'roast' || view === 'settings' ? 'hidden' : 'auto',
                            background: 'var(--color-surface)',
                        }}
                    >
                        {view !== 'settings' && (
                            <InventoryAlertBanner userId={workspaceOwnerId || user.id} onNavigate={setView} />
                        )}
                        {view === 'settings' && (
                            <ViewErrorBoundary>
                                <Settings
                                    activeTab={settingsTab}
                                    onTabChange={setSettingsTab}
                                    onClose={() => setView(settingsReturnView.current)}
                                />
                            </ViewErrorBoundary>
                        )}
                        {view === 'dashboard' && (
                            <ViewErrorBoundary>
                                <Dashboard onNavigate={setView} />
                            </ViewErrorBoundary>
                        )}
                        {/* 탭 전환 시 화면 상태를 유지한다. 수집·타이머는 화면 오류 경계 밖에서 계속 실행된다. */}
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
                            <ActiveRoastRuntime isActive={view === 'roast'} />
                            <ViewErrorBoundary>
                                <ActiveRoast
                                    key={roastMount}
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
                        {view === 'cupping' && (
                            <ViewErrorBoundary>
                                <Cupping onUpgrade={openComparePlans} />
                            </ViewErrorBoundary>
                        )}
                        {view === 'orders' && (
                            <ViewErrorBoundary>
                                <Orders onUpgrade={openComparePlans} />
                            </ViewErrorBoundary>
                        )}
                        {view === 'beans' && (
                            <ViewErrorBoundary>
                                <Beans onNavigate={setView} onUpgrade={openComparePlans} />
                            </ViewErrorBoundary>
                        )}
                        {view === 'pricing' && (
                            <ViewErrorBoundary>
                                <Pricing onNavigate={setView} />
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
        </ErrorBoundary>
    );
};
