// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useRoastKeyboardShortcuts } from './useRoastKeyboardShortcuts';

vi.mock('@tauri-apps/plugin-dialog', () => ({ message: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('accepts Drop after focus returns without a click, while clearing a tap from before blur', () => {
    const onMarkDrop = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const Probe = () => {
        useRoastKeyboardShortcuts({
            isActive: true,
            isFullscreen: false,
            showEndRoastModal: false,
            showSummaryModal: false,
            phase: 'roasting',
            awaitingNextCharge: false,
            onToggleFullscreen: vi.fn(),
            onExitFullscreen: vi.fn(),
            onEnterStandby: vi.fn(),
            onManualCharge: vi.fn(),
            onMarkEvent: vi.fn(),
            onMarkDrop,
        });
        return createElement('button', { type: 'button' }, 'Roast');
    };
    const tap = (repeat = false) =>
        act(() => {
            for (const type of ['keydown', 'keyup'])
                document.dispatchEvent(
                    new KeyboardEvent(type, {
                        key: 'd',
                        code: 'KeyD',
                        ctrlKey: true,
                        bubbles: true,
                        cancelable: true,
                        repeat,
                    }),
                );
        });
    try {
        act(() => root.render(createElement(Probe)));
        tap();
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
        tap();
        expect(onMarkDrop).not.toHaveBeenCalled();
        tap(true);
        expect(onMarkDrop).not.toHaveBeenCalled();
        tap();
        expect(onMarkDrop).toHaveBeenCalledTimes(1);
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
