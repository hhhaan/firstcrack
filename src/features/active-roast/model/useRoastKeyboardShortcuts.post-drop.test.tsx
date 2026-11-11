/** @vitest-environment jsdom */
import { useRoastKeyboardShortcuts } from '@features/active-roast/model/useRoastKeyboardShortcuts';
import { hydrateShortcutBindings, useShortcutStore } from '@shared/store/keyboard-shortcuts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modKey = (ctrlKey: boolean) => ({ key: '6', code: 'Digit6', ctrlKey, metaKey: !ctrlKey, bubbles: true });
const chargeKey = (ctrlKey: boolean) => ({ key: 'Enter', code: 'Enter', ctrlKey, metaKey: !ctrlKey, bubbles: true });

describe('post-drop keyboard flow', () => {
    let root: Root;
    const host = document.createElement('div');

    beforeEach(async () => {
        localStorage.clear();
        useShortcutStore.getState().resetBindings();
        await hydrateShortcutBindings();
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('closes the summary popup then allows Charge for the next batch', () => {
        const onCloseRoastSummary = vi.fn();
        const onManualCharge = vi.fn();
        const onMarkDrop = vi.fn();
        let showSummaryModal = true;

        const View = () => {
            useRoastKeyboardShortcuts({
                isActive: true,
                isFullscreen: false,
                showEndRoastModal: false,
                showSummaryModal,
                phase: 'standby',
                awaitingNextCharge: true,
                onToggleFullscreen: vi.fn(),
                onExitFullscreen: vi.fn(),
                onEnterStandby: vi.fn(),
                onManualCharge,
                onMarkEvent: vi.fn(),
                onMarkDrop,
                onCloseRoastSummary: () => {
                    showSummaryModal = false;
                    onCloseRoastSummary();
                },
            });
            return null;
        };

        act(() => root.render(createElement(View)));

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', modKey(true)));
        });
        expect(onCloseRoastSummary).toHaveBeenCalledTimes(1);
        expect(onMarkDrop).not.toHaveBeenCalled();

        act(() => root.render(createElement(View)));

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', chargeKey(true)));
        });
        expect(onManualCharge).toHaveBeenCalledTimes(1);
        expect(onCloseRoastSummary).toHaveBeenCalledTimes(1);
    });

    it('does not close the summary while a memo field is focused without a mod chord', () => {
        const onCloseRoastSummary = vi.fn();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        const View = () => {
            useRoastKeyboardShortcuts({
                isActive: true,
                isFullscreen: false,
                showEndRoastModal: false,
                showSummaryModal: true,
                phase: 'standby',
                awaitingNextCharge: true,
                onToggleFullscreen: vi.fn(),
                onExitFullscreen: vi.fn(),
                onEnterStandby: vi.fn(),
                onManualCharge: vi.fn(),
                onMarkEvent: vi.fn(),
                onMarkDrop: vi.fn(),
                onCloseRoastSummary,
            });
            return null;
        };

        act(() => root.render(createElement(View)));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { ...modKey(true), target: input } as KeyboardEventInit));
        });
        // mod+6 is allowed on form tags when the binding uses mod
        expect(onCloseRoastSummary).toHaveBeenCalledTimes(1);

        onCloseRoastSummary.mockClear();
        act(() => {
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: '6',
                    code: 'Digit6',
                    bubbles: true,
                    target: input,
                } as KeyboardEventInit),
            );
        });
        expect(onCloseRoastSummary).not.toHaveBeenCalled();
        input.remove();
    });
});
