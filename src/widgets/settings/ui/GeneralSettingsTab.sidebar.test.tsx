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
        expect(moveButton('Up', 'roast').disabled).toBe(true);
        expect(moveButton('Down', 'cupping').disabled).toBe(true);
        expect(moveButton('Up', 'dashboard').disabled).toBe(true);
        expect(moveButton('Down', 'pricing').disabled).toBe(true);

        act(() => moveButton('Down', 'roast').click());

        expect(groupItems('sidebar.groups.roasting')).toEqual(['history', 'roast', 'profiles', 'machines', 'cupping']);
        expect(groupItems('sidebar.groups.operations')).toEqual([
            'dashboard',
            'schedule',
            'beans',
            'orders',
            'pricing',
        ]);
        expect(moveButton('Up', 'history').disabled).toBe(true);
        expect(moveButton('Down', 'roast').disabled).toBe(false);

        act(() => {
            const reset = [...container.querySelectorAll('button')].find(
                (button) => button.textContent === 'settings.tabs.general.sidebarReset',
            );
            reset?.click();
        });

        expect(groupItems('sidebar.groups.roasting')).toEqual(['roast', 'history', 'profiles', 'machines', 'cupping']);
        expect(groupItems('sidebar.groups.operations')).toEqual([
            'dashboard',
            'schedule',
            'beans',
            'orders',
            'pricing',
        ]);
    });
});
