// @vitest-environment jsdom

import { useActiveRoastOnboardingStore } from '@features/active-roast/model/onboarding';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ActiveRoastOnboarding } from './ActiveRoastOnboarding';

vi.mock('@shared/lib/useDoubleShortcut', () => ({
    useBoundShortcut: () => {},
}));

vi.mock('@shared/store/keyboard-shortcuts', () => ({
    formatShortcut: () => 'F',
    useShortcutKeys: () => ['f'],
    useShortcutStore: (sel: (s: { recording: boolean; dialogOpen: boolean }) => unknown) =>
        sel({ recording: false, dialogOpen: false }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => (key === 'activeRoast.onboarding.done' ? 'Done' : key),
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('dismisses the tour when Done is clicked on the only step', () => {
    vi.useFakeTimers();
    useActiveRoastOnboardingStore.setState({ fullscreenHintSeen: false, sessionDismissed: false });

    const chart = document.createElement('div');
    chart.setAttribute('data-tour', 'active-roast-chart');
    chart.getBoundingClientRect = () => ({
        x: 10,
        y: 10,
        width: 120,
        height: 80,
        top: 10,
        left: 10,
        right: 130,
        bottom: 90,
        toJSON: () => ({}),
    });
    document.body.appendChild(chart);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);

    try {
        act(() => root.render(createElement(ActiveRoastOnboarding, { isActive: true })));
        act(() => vi.advanceTimersByTime(500));

        const done = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Done');
        act(() => done?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(useActiveRoastOnboardingStore.getState().sessionDismissed).toBe(true);
    } finally {
        act(() => root.unmount());
        document.body.replaceChildren();
        vi.useRealTimers();
    }
});
