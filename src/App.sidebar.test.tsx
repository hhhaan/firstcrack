// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
    initTheme: vi.fn(),
    checkAndDownload: vi.fn(() => Promise.resolve()),
    applyAndRelaunch: vi.fn(() => Promise.resolve()),
}));

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(undefined),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./shared/lib/logger', () => ({ logger: { error: vi.fn(), capture: vi.fn() } }));
vi.mock('./shared/lib/sentry', () => ({ setSentryIdentity: vi.fn() }));
vi.mock('./shared/lib/supabase', () => ({
    supabase: { auth: { exchangeCodeForSession: vi.fn(), setSession: vi.fn() } },
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('react-hotkeys-hook', () => ({ useHotkeys: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('./shared/store/auth', () => ({
    useAuthStore: (
        selector: (state: {
            user: { id: string };
            loading: boolean;
            oauthPending: boolean;
            cancelOAuth: () => void;
            init: () => void;
        }) => unknown,
    ) =>
        selector({
            user: { id: 'user-1' },
            loading: false,
            oauthPending: false,
            cancelOAuth: () => undefined,
            init: () => undefined,
        }),
}));
vi.mock('./shared/store/theme', () => ({
    useThemeStore: (selector: (state: { initTheme: () => void }) => unknown) =>
        selector({ initTheme: hooks.initTheme }),
}));
vi.mock('./shared/store/keyboard-shortcuts', () => ({
    SHORTCUT_HOTKEY_OPTIONS: {},
    shortcutHotkeys: () => [],
    useShortcutKeys: () => [],
    useShortcutStore: (
        selector: (state: { dialogOpen: boolean; recording: boolean; setDialogOpen: () => void }) => unknown,
    ) => selector({ dialogOpen: false, recording: false, setDialogOpen: () => undefined }),
}));
vi.mock('./features/active-roast', () => ({
    useRoastingStore: (
        selector: (state: { phase: string; startBatch: () => void; completeBatch: () => void }) => unknown,
    ) => selector({ phase: 'idle', startBatch: () => undefined, completeBatch: () => undefined }),
}));
vi.mock('./features/auth', () => ({ useOAuthDeepLink: () => undefined }));
vi.mock('./features/sidecar', () => ({ useSidecarDeadListener: () => ({ isDead: false }) }));
vi.mock('./features/updater', () => ({
    useUpdateChecker: () => ({
        state: { status: 'idle', version: null, progress: 0, error: null },
        checkAndDownload: hooks.checkAndDownload,
        applyAndRelaunch: hooks.applyAndRelaunch,
    }),
}));
vi.mock('./entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'owner-1' }),
}));
vi.mock('./shared/ui/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: { children: ReactNode }) => children,
    ViewErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./widgets/pending-roast-recovery', () => ({ PendingRoastRecovery: () => null }));
vi.mock('./widgets/inventory-alert-banner', () => ({ InventoryAlertBanner: () => null }));
vi.mock('./widgets/settings/ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('./views/active-roast/ActiveRoast', () => ({ ActiveRoast: () => null }));
vi.mock('./views/active-roast/ActiveRoastRuntime', () => ({ ActiveRoastRuntime: () => null }));
vi.mock('./views/bean/Beans', () => ({ Beans: () => null }));
vi.mock('./views/cupping/Cupping', () => ({ Cupping: () => null }));
vi.mock('./views/dashboard/Dashboard', () => ({ Dashboard: () => null }));
vi.mock('./views/history/History', () => ({ History: () => null }));
vi.mock('./views/login/Login', () => ({ Login: () => null }));
vi.mock('./views/machines/Machines', () => ({ Machines: () => null }));
vi.mock('./views/orders/Orders', () => ({ Orders: () => null }));
vi.mock('./views/pricing/Pricing', () => ({ Pricing: () => null }));
vi.mock('./views/profiles/Profiles', () => ({ Profiles: () => null }));
vi.mock('./views/schedule/Schedule', () => ({ Schedule: () => null }));
vi.mock('./views/settings/Settings', () => ({ Settings: () => null }));
vi.mock('./widgets/sidebar/ui/Sidebar', () => ({
    Sidebar: ({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: (view: string) => void }) =>
        createElement(
            'div',
            { 'data-testid': 'app-sidebar', 'data-collapsed': String(collapsed) },
            createElement(
                'button',
                { type: 'button', 'data-testid': 'nav-roast', onClick: () => onNavigate('roast') },
                'roast',
            ),
        ),
}));

import { setSidebarCollapsed } from '@shared/store/sidebar-preferences';
import { App } from './App';

declare global {
    interface Window {
        __FC_E2E__?: { remountRoast?: () => void; failRoastView?: () => void };
    }
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('App sidebar collapse', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        localStorage.clear();
        setSidebarCollapsed(false);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('collapses the sidebar when the roast view opens and keeps a manual expand', async () => {
        await act(async () => {
            root.render(createElement(App));
        });

        const sidebar = () => container.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
        expect(sidebar().dataset.collapsed).toBe('false');

        await act(async () => {
            (container.querySelector('[data-testid="nav-roast"]') as HTMLButtonElement).click();
        });

        expect(sidebar().dataset.collapsed).toBe('true');

        await act(async () => {
            setSidebarCollapsed(false);
        });

        expect(sidebar().dataset.collapsed).toBe('false');
    });
});
