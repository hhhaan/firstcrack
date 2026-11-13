/** @vitest-environment jsdom */
import { effectiveCustomShortcuts } from '@features/active-roast/lib/event-buttons';
import {
    isRoastSummaryShortcutEnabled,
    useRoastKeyboardShortcuts,
} from '@features/active-roast/model/useRoastKeyboardShortcuts';
import { hydrateShortcutBindings, SHORTCUTS, useShortcutStore } from '@shared/store/keyboard-shortcuts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ShortcutHostProps = Parameters<typeof useRoastKeyboardShortcuts>[0];

const defaultTaken = () => SHORTCUTS.flatMap(({ defaultKeys }) => [...defaultKeys]);

const closeSummaryKey = (ctrlKey: boolean, init: KeyboardEventInit = {}) => ({
    key: '6',
    code: 'Digit6',
    ctrlKey,
    metaKey: !ctrlKey,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
});

const saveSummaryKey = (ctrlKey: boolean, init: KeyboardEventInit = {}) => ({
    key: 's',
    code: 'KeyS',
    ctrlKey,
    metaKey: !ctrlKey,
    bubbles: true,
    cancelable: true,
    ...init,
});

const returnToWaitKey = (ctrlKey: boolean, init: KeyboardEventInit = {}) => ({
    key: '7',
    code: 'Digit7',
    ctrlKey,
    metaKey: !ctrlKey,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
});

const chargeKey = (ctrlKey: boolean) => ({
    key: 'Enter',
    code: 'Enter',
    ctrlKey,
    metaKey: !ctrlKey,
    bubbles: true,
    cancelable: true,
});

const roastShortcutBase = (override: Partial<ShortcutHostProps> = {}): ShortcutHostProps => ({
    isActive: true,
    isFullscreen: false,
    showEndRoastModal: false,
    showSummaryModal: false,
    showContinueModal: false,
    phase: 'standby',
    awaitingNextCharge: true,
    onToggleFullscreen: vi.fn(),
    onExitFullscreen: vi.fn(),
    onEnterStandby: vi.fn(),
    onManualCharge: vi.fn(),
    onMarkEvent: vi.fn(),
    onMarkDrop: vi.fn(),
    ...override,
});

describe('post-drop keyboard flow', () => {
    let root: Root;
    const host = document.createElement('div');
    let renderShortcuts: (override: Partial<ShortcutHostProps>) => void;

    beforeEach(async () => {
        localStorage.clear();
        useShortcutStore.getState().resetBindings();
        await hydrateShortcutBindings();
        document.body.appendChild(host);
        root = createRoot(host);
        renderShortcuts = (override) => {
            const View = () => {
                useRoastKeyboardShortcuts(roastShortcutBase(override));
                return null;
            };
            act(() => root.render(createElement(View)));
        };
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    const pressClose = (target?: EventTarget) =>
        act(() => {
            const node = target ?? document;
            node.dispatchEvent(new KeyboardEvent('keydown', closeSummaryKey(true)));
        });

    it('closes the summary popup then allows Charge for the next batch', () => {
        const onCloseRoastSummary = vi.fn();
        const onManualCharge = vi.fn();
        const onMarkDrop = vi.fn();
        let showSummaryModal = true;

        renderShortcuts({
            showSummaryModal,
            onManualCharge,
            onMarkDrop,
            onCloseRoastSummary: () => {
                showSummaryModal = false;
                onCloseRoastSummary();
            },
        });

        pressClose();
        expect(onCloseRoastSummary).toHaveBeenCalledTimes(1);
        expect(onMarkDrop).not.toHaveBeenCalled();

        renderShortcuts({ showSummaryModal, onManualCharge, onMarkDrop, onCloseRoastSummary });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', chargeKey(true)));
        });
        expect(onManualCharge).toHaveBeenCalledTimes(1);
    });

    it('does not close the summary while a memo field is focused without a mod chord', () => {
        const onCloseRoastSummary = vi.fn();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        renderShortcuts({ showSummaryModal: true, onCloseRoastSummary });

        pressClose(input);
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

    it('ignores key repeat for close and return-to-wait shortcuts', () => {
        const onCloseRoastSummary = vi.fn();
        const onDismissReview = vi.fn();

        renderShortcuts({ showSummaryModal: true, onCloseRoastSummary });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', closeSummaryKey(true)));
            document.dispatchEvent(new KeyboardEvent('keydown', closeSummaryKey(true, { repeat: true })));
        });
        expect(onCloseRoastSummary).toHaveBeenCalledTimes(1);

        renderShortcuts({ reviewing: true, onDismissReview });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', returnToWaitKey(true)));
            document.dispatchEvent(new KeyboardEvent('keydown', returnToWaitKey(true, { repeat: true })));
        });
        expect(onDismissReview).toHaveBeenCalledTimes(1);
    });

    it('does not close the summary while save preparation or submit is in flight', () => {
        const onCloseRoastSummary = vi.fn();
        expect(
            isRoastSummaryShortcutEnabled({
                isActive: true,
                showSummaryModal: true,
                showEndRoastModal: false,
                roastSummarySaving: true,
            }),
        ).toBe(false);

        renderShortcuts({ showSummaryModal: true, roastSummarySaving: true, onCloseRoastSummary });

        pressClose();
        expect(onCloseRoastSummary).not.toHaveBeenCalled();
    });

    it('saves the summary once per press and leaves close and Drop alone', () => {
        const onSaveRoastSummary = vi.fn();
        const onCloseRoastSummary = vi.fn();
        const onMarkDrop = vi.fn();

        renderShortcuts({ showSummaryModal: true, onSaveRoastSummary, onCloseRoastSummary, onMarkDrop });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', saveSummaryKey(true)));
            document.dispatchEvent(new KeyboardEvent('keydown', saveSummaryKey(true, { repeat: true })));
        });
        expect(onSaveRoastSummary).toHaveBeenCalledTimes(1);
        expect(onCloseRoastSummary).not.toHaveBeenCalled();
        expect(onMarkDrop).not.toHaveBeenCalled();
    });

    it('saves from a focused memo field with the mod chord only', () => {
        const onSaveRoastSummary = vi.fn();
        const input = document.createElement('textarea');
        document.body.appendChild(input);
        input.focus();

        renderShortcuts({ showSummaryModal: true, onSaveRoastSummary });

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true }));
        });
        expect(onSaveRoastSummary).not.toHaveBeenCalled();

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', saveSummaryKey(true)));
        });
        expect(onSaveRoastSummary).toHaveBeenCalledTimes(1);
        input.remove();
    });

    it('does not save without the summary popup, or while a save is in flight', () => {
        const onSaveRoastSummary = vi.fn();

        renderShortcuts({ showSummaryModal: false, onSaveRoastSummary });
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', saveSummaryKey(true)));
        });

        renderShortcuts({ showSummaryModal: true, roastSummarySaving: true, onSaveRoastSummary });
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', saveSummaryKey(true)));
        });
        expect(onSaveRoastSummary).not.toHaveBeenCalled();
    });

    it('dismisses saved-curve review back to the charge-wait chart', () => {
        const onDismissReview = vi.fn();
        renderShortcuts({ reviewing: true, onDismissReview });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', returnToWaitKey(true)));
        });
        expect(onDismissReview).toHaveBeenCalledTimes(1);
    });

    it('does not return to charge-wait while a text field is focused', () => {
        const onDismissReview = vi.fn();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        renderShortcuts({ reviewing: true, onDismissReview });

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', returnToWaitKey(true)));
        });
        expect(onDismissReview).not.toHaveBeenCalled();
        input.remove();
    });

    it('keeps mod+6 and mod+7 on the custom-event auto-assign pool', () => {
        expect(effectiveCustomShortcuts([{}, {}, {}], defaultTaken())).toEqual(['mod+4', 'mod+5', 'mod+6']);
    });
});
