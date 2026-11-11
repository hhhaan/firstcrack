/** @vitest-environment jsdom */
import { effectiveCustomShortcuts } from '@features/active-roast/lib/event-buttons';
import {
    isRoastSummaryCloseShortcutEnabled,
    useRoastKeyboardShortcuts,
} from '@features/active-roast/model/useRoastKeyboardShortcuts';
import { hydrateShortcutBindings, SHORTCUTS, useShortcutStore } from '@shared/store/keyboard-shortcuts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const defaultTaken = () => SHORTCUTS.flatMap(({ defaultKeys }) => [...defaultKeys]);

const closeSummaryKey = (ctrlKey: boolean) => ({
    key: '6',
    code: 'Digit6',
    ctrlKey,
    metaKey: !ctrlKey,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
});

const returnToWaitKey = (ctrlKey: boolean) => ({
    key: '7',
    code: 'Digit7',
    ctrlKey,
    metaKey: !ctrlKey,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
});

const chargeKey = (ctrlKey: boolean) => ({
    key: 'Enter',
    code: 'Enter',
    ctrlKey,
    metaKey: !ctrlKey,
    bubbles: true,
    cancelable: true,
});

type ShortcutHostProps = Parameters<typeof useRoastKeyboardShortcuts>[0];

describe('post-drop keyboard flow', () => {
    let root: Root;
    const host = document.createElement('div');

    const renderShortcuts = (props: ShortcutHostProps) => {
        const View = () => {
            useRoastKeyboardShortcuts(props);
            return null;
        };
        act(() => root.render(createElement(View)));
    };

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

        renderShortcuts({
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

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', closeSummaryKey(true)));
        });
        expect(onCloseRoastSummary).toHaveBeenCalledTimes(1);
        expect(onMarkDrop).not.toHaveBeenCalled();

        renderShortcuts({
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
            onCloseRoastSummary,
        });

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

        renderShortcuts({
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

        act(() => {
            input.dispatchEvent(
                new KeyboardEvent('keydown', { ...closeSummaryKey(true), target: input } as KeyboardEventInit),
            );
        });
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

        renderShortcuts({
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

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', closeSummaryKey(true)));
            document.dispatchEvent(
                new KeyboardEvent('keydown', { ...closeSummaryKey(true), repeat: true } as KeyboardEventInit),
            );
        });
        expect(onCloseRoastSummary).toHaveBeenCalledTimes(1);

        renderShortcuts({
            isActive: true,
            isFullscreen: false,
            showEndRoastModal: false,
            showSummaryModal: false,
            reviewing: true,
            phase: 'standby',
            awaitingNextCharge: true,
            onToggleFullscreen: vi.fn(),
            onExitFullscreen: vi.fn(),
            onEnterStandby: vi.fn(),
            onManualCharge: vi.fn(),
            onMarkEvent: vi.fn(),
            onMarkDrop: vi.fn(),
            onDismissReview,
        });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', returnToWaitKey(true)));
            document.dispatchEvent(
                new KeyboardEvent('keydown', { ...returnToWaitKey(true), repeat: true } as KeyboardEventInit),
            );
        });
        expect(onDismissReview).toHaveBeenCalledTimes(1);
    });

    it('does not close the summary while save preparation or submit is in flight', () => {
        const onCloseRoastSummary = vi.fn();
        expect(
            isRoastSummaryCloseShortcutEnabled({
                isActive: true,
                showSummaryModal: true,
                showEndRoastModal: false,
                roastSummarySaving: true,
            }),
        ).toBe(false);

        renderShortcuts({
            isActive: true,
            isFullscreen: false,
            showEndRoastModal: false,
            showSummaryModal: true,
            roastSummarySaving: true,
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

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', closeSummaryKey(true)));
        });
        expect(onCloseRoastSummary).not.toHaveBeenCalled();
    });

    it('routes close to Drop cancel when undo is still allowed', () => {
        const onCloseRoastSummary = vi.fn();
        const onCancelRoastSummary = vi.fn();

        renderShortcuts({
            isActive: true,
            isFullscreen: false,
            showEndRoastModal: false,
            showSummaryModal: true,
            canCancelRoastSummary: true,
            phase: 'standby',
            awaitingNextCharge: true,
            onToggleFullscreen: vi.fn(),
            onExitFullscreen: vi.fn(),
            onEnterStandby: vi.fn(),
            onManualCharge: vi.fn(),
            onMarkEvent: vi.fn(),
            onMarkDrop: vi.fn(),
            onCloseRoastSummary,
            onCancelRoastSummary,
        });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', closeSummaryKey(true)));
        });
        expect(onCancelRoastSummary).toHaveBeenCalledTimes(1);
        expect(onCloseRoastSummary).not.toHaveBeenCalled();
    });

    it('dismisses saved-curve review back to the charge-wait chart', () => {
        const onDismissReview = vi.fn();

        renderShortcuts({
            isActive: true,
            isFullscreen: false,
            showEndRoastModal: false,
            showSummaryModal: false,
            reviewing: true,
            phase: 'standby',
            awaitingNextCharge: true,
            onToggleFullscreen: vi.fn(),
            onExitFullscreen: vi.fn(),
            onEnterStandby: vi.fn(),
            onManualCharge: vi.fn(),
            onMarkEvent: vi.fn(),
            onMarkDrop: vi.fn(),
            onDismissReview,
        });

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', returnToWaitKey(true)));
        });
        expect(onDismissReview).toHaveBeenCalledTimes(1);
    });

    it('keeps mod+6 and mod+7 on the custom-event auto-assign pool', () => {
        expect(effectiveCustomShortcuts([{}, {}, {}], defaultTaken())).toEqual(['mod+4', 'mod+5', 'mod+6']);
    });
});
