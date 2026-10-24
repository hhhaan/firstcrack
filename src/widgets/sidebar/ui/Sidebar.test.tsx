// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({
        workspaceOwnerId: 'owner',
        authUserId: 'owner',
        memberships: [],
        setActiveOwner: vi.fn(),
    }),
}));
vi.mock('@shared/store/auth', () => ({ useAuthStore: () => ({ id: 'owner' }) }));
vi.mock('@shared/store/theme', () => ({ useThemeStore: () => 'light' }));
vi.mock('@shared/store/keyboard-shortcuts', () => ({
    useShortcutKeys: () => [],
    formatShortcut: () => '',
}));
vi.mock('../../../entities/profile', () => ({ useProfile: () => ({ data: null }) }));
vi.mock('./SidebarNav', () => ({ SidebarNav: () => null }));

import { Sidebar } from './Sidebar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps keyboard focus on the same toggle across collapse and expand', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onNavigate = vi.fn();
    const onOpenSettings = vi.fn();

    function TestSidebar() {
        const [collapsed, setCollapsed] = useState(false);
        return createElement(Sidebar, {
            activeView: 'dashboard',
            collapsed,
            onNavigate,
            onOpenSettings,
            footerAction: createElement('button', { type: 'button', 'aria-label': 'Update ready' }, 'Update'),
            onToggleCollapse: () => setCollapsed((value) => !value),
        });
    }

    try {
        await act(async () => root.render(createElement(TestSidebar)));
        const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
        expect(toggle).not.toBeNull();
        expect(container.querySelector('button[aria-label="Update ready"]')).not.toBeNull();
        toggle?.focus();

        for (const expanded of ['false', 'true']) {
            await act(async () => toggle?.click());
            expect(container.querySelector('button[aria-expanded]')).toBe(toggle);
            expect(container.querySelector('button[aria-label="Update ready"]')).not.toBeNull();
            expect(document.activeElement).toBe(toggle);
            expect(toggle?.getAttribute('aria-expanded')).toBe(expanded);
            expect(toggle?.getAttribute('aria-label')).toBe(
                expanded === 'true' ? 'sidebar.collapse' : 'sidebar.expand',
            );
        }
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
