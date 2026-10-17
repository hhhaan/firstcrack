// @vitest-environment jsdom

import { resetSidebarOrder, setSidebarCollapsed } from '@shared/store/sidebar-preferences';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralSettingsTab } from './GeneralSettingsTab';

vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn().mockResolvedValue(undefined),
    settingsSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@shared/i18n', () => ({
    setLanguage: vi.fn(),
    supportedLanguages: [],
}));

vi.mock('@shared/lib/inventoryStore', () => ({
    inventoryStore: {
        getHorizonDays: vi.fn().mockResolvedValue(28),
        setHorizonDays: vi.fn(),
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
        i18n: { resolvedLanguage: 'en' },
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const moveLabel = (direction: 'Up' | 'Down', id: string) =>
    `settings.tabs.general.sidebarMove${direction}:sidebar.nav.${id}`;

describe('GeneralSettingsTab sidebar order', () => {
    let container: HTMLDivElement;
    let root: Root;

    const groupItems = (group: string) =>
        [...container.querySelectorAll(`[data-sidebar-group="${group}"] [data-sidebar-item]`)].map((el) =>
            el.getAttribute('data-sidebar-item'),
        );

    const moveButton = (direction: 'Up' | 'Down', id: string) =>
        container.querySelector(`[aria-label="${moveLabel(direction, id)}"]`) as HTMLButtonElement;

    beforeEach(() => {
        localStorage.clear();
        resetSidebarOrder();
        setSidebarCollapsed(false);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(createElement(GeneralSettingsTab)));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('moves one step inside a group and resets to the default order', () => {
        expect(moveButton('Up', 'schedule').disabled).toBe(true);
        expect(moveButton('Down', 'machines').disabled).toBe(true);
        expect(moveButton('Up', 'dashboard').disabled).toBe(true);
        expect(moveButton('Down', 'pricing').disabled).toBe(true);

        act(() => moveButton('Down', 'roast').click());

        expect(groupItems('sidebar.groups.roasting')).toEqual([
            'schedule',
            'history',
            'roast',
            'profiles',
            'cupping',
            'machines',
        ]);
        expect(groupItems('sidebar.groups.operations')).toEqual(['dashboard', 'beans', 'orders', 'pricing']);
        expect(moveButton('Up', 'history').disabled).toBe(false);
        expect(moveButton('Down', 'roast').disabled).toBe(false);

        act(() => {
            const reset = [...container.querySelectorAll('button')].find(
                (button) => button.textContent === 'settings.tabs.general.sidebarReset',
            );
            reset?.click();
        });

        expect(groupItems('sidebar.groups.roasting')).toEqual([
            'schedule',
            'roast',
            'history',
            'profiles',
            'cupping',
            'machines',
        ]);
        expect(groupItems('sidebar.groups.operations')).toEqual(['dashboard', 'beans', 'orders', 'pricing']);
    });

    it('hides an item and shows it again on reset', () => {
        const cupping = container.querySelector('[data-sidebar-item="cupping"]');
        expect(cupping?.getAttribute('data-sidebar-hidden')).toBe('false');

        act(() => {
            container
                .querySelector<HTMLButtonElement>(
                    '[aria-label="settings.tabs.general.sidebarHide:sidebar.nav.cupping"]',
                )
                ?.click();
        });

        expect(container.querySelector('[data-sidebar-item="cupping"]')?.getAttribute('data-sidebar-hidden')).toBe(
            'true',
        );
        expect(groupItems('sidebar.groups.roasting')).toContain('cupping');

        act(() => {
            const reset = [...container.querySelectorAll('button')].find(
                (button) => button.textContent === 'settings.tabs.general.sidebarReset',
            );
            reset?.click();
        });

        expect(container.querySelector('[data-sidebar-item="cupping"]')?.getAttribute('data-sidebar-hidden')).toBe(
            'false',
        );
    });
});
