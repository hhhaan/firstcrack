// @vitest-environment jsdom

import { useActiveRoastOnboardingStore } from '@features/active-roast/model/onboarding';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        t: (key: string, opts?: { current?: number; total?: number }) => {
            if (key === 'activeRoast.onboarding.done') return 'Done';
            if (key === 'activeRoast.onboarding.progress' && opts) return `${opts.current}/${opts.total}`;
            return key;
        },
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountChartTarget = () => {
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
    return chart;
};

describe('ActiveRoastOnboarding', () => {
    let root: Root;
    let host: HTMLDivElement;

    beforeEach(() => {
        vi.useFakeTimers();
        useActiveRoastOnboardingStore.setState({
            fullscreenHintSeen: false,
            sessionDismissed: false,
        });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        mountChartTarget();
    });

    afterEach(() => {
        act(() => root.unmount());
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    it('dismisses on Done without retrying a removed settings tour target', () => {
        act(() => root.render(createElement(ActiveRoastOnboarding, { isActive: true })));
        act(() => {
            vi.advanceTimersByTime(500);
        });

        const done = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Done');
        expect(done).toBeTruthy();

        act(() => {
            done?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(useActiveRoastOnboardingStore.getState().sessionDismissed).toBe(true);

        act(() => {
            vi.advanceTimersByTime(20 * 200 + 100);
        });
        expect(document.querySelector('[data-tour="active-roast-settings"]')).toBeNull();
        expect(host.textContent).toBe('');
    });
});
