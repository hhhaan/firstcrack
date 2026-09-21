// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedRoastBanner } from './UnsavedRoastBanner';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { time?: string }) => (opts?.time ? `${key}:${opts.time}` : key),
    }),
}));

describe('UnsavedRoastBanner', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        void act(() => root.unmount());
        container.remove();
    });

    it('shows reopen and explicit Drop cancel before the next Charge', () => {
        const onReopen = vi.fn();
        const onCancelDrop = vi.fn();
        void act(() =>
            root.render(
                createElement(UnsavedRoastBanner, {
                    timeStr: '10:00',
                    cancelable: true,
                    onReopen,
                    onCancelDrop,
                }),
            ),
        );
        expect(container.querySelector('[data-testid="unsaved-roast-banner"]')?.textContent).toContain('10:00');
        expect(container.querySelector('[data-testid="unsaved-roast-cancel-drop"]')).not.toBeNull();
        void act(() => (container.querySelector('[data-testid="unsaved-roast-reopen"]') as HTMLButtonElement).click());
        expect(onReopen).toHaveBeenCalledTimes(1);
    });

    it('hides Drop cancel after the next-Charge boundary', () => {
        void act(() =>
            root.render(
                createElement(UnsavedRoastBanner, {
                    timeStr: '10:00',
                    cancelable: false,
                    onReopen: () => undefined,
                    onCancelDrop: () => undefined,
                }),
            ),
        );
        expect(container.querySelector('[data-testid="unsaved-roast-cancel-drop"]')).toBeNull();
        expect(container.querySelector('[data-testid="unsaved-roast-reopen"]')).not.toBeNull();
    });
});
