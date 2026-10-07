// @vitest-environment jsdom

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSidebar } from './SettingsSidebar';
import type { RoastSettingsGroup, SettingsTabId } from './tabConfig';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ initialTab = 'roast' as SettingsTabId }) {
    const [tab, setTab] = useState(initialTab);
    const [group, setGroup] = useState<RoastSettingsGroup | null>(null);
    return createElement(SettingsSidebar, {
        activeTab: tab,
        onTabChange: (next: SettingsTabId) => {
            setGroup(null);
            setTab(next);
        },
        onClose: () => undefined,
        query: '',
        onQueryChange: () => undefined,
        activeRoastGroup: group,
        onRoastGroupChange: setGroup,
    });
}

describe('SettingsSidebar roast groups', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    const mount = (initialTab?: SettingsTabId) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root.render(createElement(Harness, { initialTab })));
    };

    const roastButton = () => host.querySelector('button[aria-expanded]') as HTMLButtonElement;
    const groupList = () => host.querySelector('#settings-roast-navigation');

    it('collapses and expands the roast groups from the full roast page', () => {
        mount();
        expect(roastButton().getAttribute('aria-expanded')).toBe('true');
        expect(groupList()).not.toBeNull();

        act(() => roastButton().click());
        expect(roastButton().getAttribute('aria-expanded')).toBe('false');
        expect(groupList()).toBeNull();

        act(() => roastButton().click());
        expect(roastButton().getAttribute('aria-expanded')).toBe('true');
        expect(groupList()?.querySelectorAll('button')).toHaveLength(7);
    });

    it('returns to the full roast page before a later click collapses the groups', () => {
        mount();
        const alerts = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === 'settings.tabs.roast.groups.alerts',
        ) as HTMLButtonElement;

        act(() => alerts.click());
        expect(alerts.getAttribute('aria-current')).toBe('page');
        expect(groupList()).not.toBeNull();

        act(() => roastButton().click());
        expect(roastButton().getAttribute('aria-current')).toBe('page');
        expect(groupList()).not.toBeNull();

        act(() => roastButton().click());
        expect(groupList()).toBeNull();
    });

    it('opens the roast groups when entering the roast tab', () => {
        mount('general');
        expect(groupList()).toBeNull();

        act(() => roastButton().click());
        expect(roastButton().getAttribute('aria-expanded')).toBe('true');
        expect(groupList()).not.toBeNull();
    });
});
