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

    const pressSave = (target?: EventTarget) =>
        act(() => {
            const node = target ?? document;
            node.dispatchEvent(new KeyboardEvent('keydown', saveSummaryKey(true)));
        });

    it('saves the summary popup then allows Charge for the next batch', () => {
        const onSaveRoastSummary = vi.fn();
        const onManualCharge = vi.fn();
        const onMarkDrop = vi.fn();

        renderShortcuts({ showSummaryModal: true, onManualCharge, onMarkDrop, onSaveRoastSummary });

        pressSave();
        expect(onSaveRoastSummary).toHaveBeenCalledTimes(1);
        expect(onMarkDrop).not.toHaveBeenCalled();

        renderShortcuts({ showSummaryModal: false, onManualCharge, onMarkDrop, onSaveRoastSummary });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', chargeKey(true)));
        });
        expect(onManualCharge).toHaveBeenCalledTimes(1);
    });

    it('has no summary close shortcut: the old chord does nothing while the popup is open', () => {
        const onSaveRoastSummary = vi.fn();
        const onMarkDrop = vi.fn();
        expect(SHORTCUTS.some(({ id }) => (id as string) === 'closeRoastSummary')).toBe(false);

        renderShortcuts({ showSummaryModal: true, onSaveRoastSummary, onMarkDrop });

        act(() => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: '6',
                    code: 'Digit6',
                    ctrlKey: true,
                    shiftKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            );
        });
        expect(onSaveRoastSummary).not.toHaveBeenCalled();
        expect(onMarkDrop).not.toHaveBeenCalled();
    });

    it('ignores key repeat for the return-to-wait shortcut', () => {
        const onDismissReview = vi.fn();

        renderShortcuts({ reviewing: true, onDismissReview });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', returnToWaitKey(true)));
            document.dispatchEvent(new KeyboardEvent('keydown', returnToWaitKey(true, { repeat: true })));
        });
        expect(onDismissReview).toHaveBeenCalledTimes(1);
    });

    it('keeps the summary shortcut off while save preparation or submit is in flight', () => {
        expect(
            isRoastSummaryShortcutEnabled({
                isActive: true,
                showSummaryModal: true,
                showEndRoastModal: false,
                roastSummarySaving: true,
            }),
        ).toBe(false);
    });

    it('saves the summary once per press and leaves Drop alone', () => {
        const onSaveRoastSummary = vi.fn();
        const onMarkDrop = vi.fn();

        renderShortcuts({ showSummaryModal: true, onSaveRoastSummary, onMarkDrop });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', saveSummaryKey(true)));
            document.dispatchEvent(new KeyboardEvent('keydown', saveSummaryKey(true, { repeat: true })));
        });
        expect(onSaveRoastSummary).toHaveBeenCalledTimes(1);
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
