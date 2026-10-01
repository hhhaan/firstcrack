import { i18n } from '@shared/i18n';
import { message } from '@tauri-apps/plugin-dialog';
import { useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

interface UseRoastKeyboardShortcutsParams {
    isActive: boolean;
    isFullscreen: boolean;
    showEndRoastModal: boolean;
    showSummaryModal: boolean;
    /** When true, block roast hotkeys while continue-batch modal is open. */
    showContinueModal?: boolean;
    phase: string;
    awaitingNextCharge: boolean;
    hasUnsavedCompleted?: boolean;
    onToggleFullscreen: () => void;
    onExitFullscreen: () => void;
    onEnterStandby: () => void;
    onManualCharge: () => void;
    onMarkEvent: (event: string, note: string, pressKey: string) => void;
    /** When set, mod+2 uses dual-mark cycle instead of toggle FC Start. */
    onCycleFc?: () => void;
    onMarkDrop: () => void;
}

/** Base gate shared by all roast hotkeys (modals close the keyboard surface). */
export function isRoastShortcutBaseEnabled(p: {
    isActive: boolean;
    showEndRoastModal: boolean;
    showSummaryModal: boolean;
    showContinueModal?: boolean;
}): boolean {
    return p.isActive && !p.showEndRoastModal && !p.showSummaryModal && !p.showContinueModal;
}

/** Charge (and Roast Ready) stay available while the result form is open. */
export function isRoastChargeShortcutEnabled(p: {
    isActive: boolean;
    showEndRoastModal: boolean;
    showContinueModal?: boolean;
    phase: string;
}): boolean {
    return (
        p.isActive &&
        !p.showEndRoastModal &&
        !p.showContinueModal &&
        (p.phase === 'standby' || p.phase === 'preheating')
    );
}

/** Event-mark buttons + hotkeys: Yellow / FC / Drop only while roasting. */
export function isRoastEventMarkEnabled(phase: string): boolean {
    return phase === 'roasting';
}

/** In-memory roast that a webview reload would drop. Preheat and standby stay refreshable. */
export function isRoastRefreshBlocked(
    phase: string,
    awaitingNextCharge: boolean,
    hasUnsavedCompleted = false,
): boolean {
    return phase === 'roasting' || awaitingNextCharge || hasUnsavedCompleted;
}

/**
 * Event-marking hotkeys (Yellow / FC / Drop) only while roasting.
 * Standby/preheating must not create Drop etc. (disarms alerts).
 */
export function isRoastMarkShortcutEnabled(p: {
    isActive: boolean;
    showEndRoastModal: boolean;
    showSummaryModal: boolean;
    showContinueModal?: boolean;
    phase: string;
}): boolean {
    return isRoastShortcutBaseEnabled(p) && isRoastEventMarkEnabled(p.phase);
}

export const useRoastKeyboardShortcuts = ({
    isActive,
    isFullscreen,
    showEndRoastModal,
    showSummaryModal,
    showContinueModal = false,
    phase,
    awaitingNextCharge,
    hasUnsavedCompleted = false,
    onToggleFullscreen,
    onExitFullscreen,
    onEnterStandby,
    onManualCharge,
    onMarkEvent,
    onCycleFc,
    onMarkDrop,
}: UseRoastKeyboardShortcutsParams) => {
    const enabled = isRoastShortcutBaseEnabled({
        isActive,
        showEndRoastModal,
        showSummaryModal,
        showContinueModal,
    });
    const canCharge = isRoastChargeShortcutEnabled({
        isActive,
        showEndRoastModal,
        showContinueModal,
        phase,
    });
    const canMark = isRoastMarkShortcutEnabled({
        isActive,
        showEndRoastModal,
        showSummaryModal,
        showContinueModal,
        phase,
    });

    useEffect(() => {
        // `pnpm dev` in a browser keeps F5. Only the desktop webview drops the roast on reload.
        if (!('__TAURI_INTERNALS__' in window)) return;
        if (!isRoastRefreshBlocked(phase, awaitingNextCharge, hasUnsavedCompleted)) return;

        let alertOpen = false;
        const preventRefresh = (event: KeyboardEvent) => {
            const refresh = event.key === 'F5' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r');
            if (!refresh) return;
            event.preventDefault();
            if (event.repeat || alertOpen) return;
            alertOpen = true;
            void message(i18n.t('activeRoast.dialogs.refreshBlockedMsg'), {
                title: i18n.t('activeRoast.dialogs.refreshBlockedTitle'),
                kind: 'warning',
            }).finally(() => {
                alertOpen = false;
            });
        };
        window.addEventListener('keydown', preventRefresh, true);
        return () => window.removeEventListener('keydown', preventRefresh, true);
    }, [phase, awaitingNextCharge, hasUnsavedCompleted]);

    // Escape → exit fullscreen (only when fullscreen and no modal open)
    useHotkeys(
        'escape',
        (e) => {
            e.preventDefault();
            onExitFullscreen();
        },
        { enabled: enabled && isFullscreen },
        [enabled, isFullscreen, onExitFullscreen],
    );

    // F → toggle fullscreen (case-insensitive — library normalises via toLowerCase)
    useHotkeys(
        'f',
        (e) => {
            e.preventDefault();
            onToggleFullscreen();
        },
        { enabled },
        [enabled, onToggleFullscreen],
    );

    // Ctrl/Meta + Enter → enter standby or charge
    useHotkeys(
        'mod+enter',
        (e) => {
            e.preventDefault();
            if (phase === 'preheating') onEnterStandby();
            else if (phase === 'standby') onManualCharge();
        },
        { enabled: canCharge, enableOnFormTags: true },
        [canCharge, phase, onEnterStandby, onManualCharge],
    );

    // Ctrl/Meta + 1 → Mark Yellow
    useHotkeys(
        'mod+1',
        (e) => {
            e.preventDefault();
            onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow');
        },
        { enabled: canMark },
        [canMark, onMarkEvent],
    );

    // Ctrl/Meta + 2 → Mark FC Start (or dual-mark cycle when onCycleFc provided)
    useHotkeys(
        'mod+2',
        (e) => {
            e.preventDefault();
            if (onCycleFc) onCycleFc();
            else onMarkEvent('FC Start', 'First crack started', 'Mark FC Start');
        },
        { enabled: canMark },
        [canMark, onMarkEvent, onCycleFc],
    );

    // Ctrl/Meta + 3 → Mark FC End
    useHotkeys(
        'mod+3',
        (e) => {
            e.preventDefault();
            onMarkEvent('FC End', 'First crack ended', 'Mark FC End');
        },
        { enabled: canMark },
        [canMark, onMarkEvent],
    );

    // Ctrl/Meta + D → Mark Drop (case-insensitive)
    useHotkeys(
        'mod+d',
        (e) => {
            e.preventDefault();
            onMarkDrop();
        },
        { enabled: canMark },
        [canMark, onMarkDrop],
    );
};
