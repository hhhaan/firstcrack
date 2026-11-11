import { effectiveCustomShortcuts } from '@features/active-roast/lib/event-buttons';
import { useRoastSettings } from '@features/active-roast/model/settings';
import { useGlobalDropShortcut } from '@features/active-roast/model/useGlobalDropShortcut';
import { i18n } from '@shared/i18n';
import { doubleShortcut } from '@shared/lib/shortcut-key';
import { isDoubleShortcutEvent, useBoundShortcut } from '@shared/lib/useDoubleShortcut';
import {
    eventToShortcut,
    SHORTCUT_HOTKEY_OPTIONS,
    SHORTCUTS,
    sameShortcut,
    shortcutHotkeys,
    useShortcutKeys,
    useShortcutStore,
} from '@shared/store/keyboard-shortcuts';
import { message } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

/** One physical press can reach both the OS hotkey and the webview. Collapse that pair. */
const DROP_SHORTCUT_DEDUPE_MS = 100;

interface UseRoastKeyboardShortcutsParams {
    isActive: boolean;
    isFullscreen: boolean;
    showEndRoastModal: boolean;
    showSummaryModal: boolean;
    /** When true, block roast hotkeys while continue-batch modal is open. */
    showContinueModal?: boolean;
    phase: string;
    awaitingNextCharge: boolean;
    onToggleFullscreen: () => void;
    onExitFullscreen: () => void;
    onEnterStandby: () => void;
    onManualCharge: () => void;
    onMarkEvent: (event: string, note: string, pressKey: string) => void;
    /** When set, mod+2 uses dual-mark cycle instead of toggle FC Start. */
    onCycleFc?: () => void;
    onMarkDrop: () => void;
    onCloseRoastSummary?: () => void;
    /** Matches the summary close button: cancel Drop while undo is still allowed. */
    onCancelRoastSummary?: () => void;
    canCancelRoastSummary?: boolean;
    reviewing?: boolean;
    chargeLocked?: boolean;
    onDismissReview?: () => void;
    /** Matches summary modal `isSaving` (includes save preparation). */
    roastSummarySaving?: boolean;
    /** Saved-curve review keeps Yellow / FC / custom hotkeys. Drop stays live-only. */
    markWhileReviewing?: boolean;
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
export function isRoastRefreshBlocked(phase: string, awaitingNextCharge: boolean): boolean {
    return phase === 'roasting' || phase === 'ended' || awaitingNextCharge;
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

/** Summary popup only — closes without starting the next batch. */
export function isRoastSummaryCloseShortcutEnabled(p: {
    isActive: boolean;
    showSummaryModal: boolean;
    showEndRoastModal: boolean;
    showContinueModal?: boolean;
    roastSummarySaving?: boolean;
}): boolean {
    return p.isActive && p.showSummaryModal && !p.showEndRoastModal && !p.showContinueModal && !p.roastSummarySaving;
}

/** Saved-curve overlay after a successful save — same slot as “Return to charge wait”. */
export function isRoastReturnToChargeWaitShortcutEnabled(p: {
    isActive: boolean;
    reviewing: boolean;
    showEndRoastModal: boolean;
    showSummaryModal: boolean;
    showContinueModal?: boolean;
    chargeLocked?: boolean;
}): boolean {
    return (
        p.isActive &&
        p.reviewing &&
        !p.showEndRoastModal &&
        !p.showSummaryModal &&
        !p.showContinueModal &&
        !p.chargeLocked
    );
}

export const useRoastKeyboardShortcuts = ({
    isActive,
    isFullscreen,
    showEndRoastModal,
    showSummaryModal,
    showContinueModal = false,
    phase,
    awaitingNextCharge,
    onToggleFullscreen,
    onExitFullscreen,
    onEnterStandby,
    onManualCharge,
    onMarkEvent,
    onCycleFc,
    onMarkDrop,
    onCloseRoastSummary,
    onCancelRoastSummary,
    canCancelRoastSummary = false,
    reviewing = false,
    chargeLocked = false,
    onDismissReview,
    roastSummarySaving = false,
    markWhileReviewing = false,
}: UseRoastKeyboardShortcutsParams) => {
    const recording = useShortcutStore((state) => state.recording);
    const dialogOpen = useShortcutStore((state) => state.dialogOpen);
    const fullscreenKeys = useShortcutKeys('toggleFullscreen');
    const exitFullscreenKeys = useShortcutKeys('exitFullscreen');
    const chargeKeys = useShortcutKeys('charge');
    const yellowKeys = useShortcutKeys('yellow');
    const fcStartKeys = useShortcutKeys('fcStart');
    const fcEndKeys = useShortcutKeys('fcEnd');
    const dropKeys = useShortcutKeys('drop');
    const closeSummaryKeys = useShortcutKeys('closeRoastSummary');
    const returnToChargeWaitKeys = useShortcutKeys('returnToChargeWait');
    const chargeEnabledOnFormTags = chargeKeys.every((key) => /^(?:mod|ctrl|alt)(?:\+|$)/.test(key));
    const dropEnabledOnFormTags = dropKeys.every((key) => /^(?:mod|ctrl|alt)(?:\+|$)/.test(key));
    const closeSummaryOnFormTags = closeSummaryKeys.every((key) => /^(?:mod|ctrl|alt)(?:\+|$)/.test(key));
    const onMarkDropRef = useRef(onMarkDrop);
    const lastDropShortcutAt = useRef(0);
    useEffect(() => {
        onMarkDropRef.current = onMarkDrop;
    });
    const markDropFromShortcut = useCallback(() => {
        const now = Date.now();
        if (now - lastDropShortcutAt.current < DROP_SHORTCUT_DEDUPE_MS) return;
        lastDropShortcutAt.current = now;
        onMarkDropRef.current();
    }, []);
    const shortcutsEnabled = !recording && !dialogOpen;
    const enabled =
        shortcutsEnabled &&
        isRoastShortcutBaseEnabled({
            isActive,
            showEndRoastModal,
            showSummaryModal,
            showContinueModal,
        });
    const canCharge =
        shortcutsEnabled &&
        isRoastChargeShortcutEnabled({
            isActive,
            showEndRoastModal,
            showContinueModal,
            phase,
        });
    const shortcutBase =
        shortcutsEnabled &&
        isRoastShortcutBaseEnabled({
            isActive,
            showEndRoastModal,
            showSummaryModal,
            showContinueModal,
        });
    const canMark = shortcutBase && isRoastEventMarkEnabled(phase);
    const canMarkEvents = canMark || (markWhileReviewing && shortcutBase);
    // OS-level Drop still covers an unfocused window. The webview hotkey stays on so a focused
    // window records Drop when the OS callback does not.
    useGlobalDropShortcut({ enabled: canMark, keys: dropKeys, onFire: markDropFromShortcut });

    useEffect(() => {
        // `pnpm dev` in a browser keeps F5. Only the desktop webview drops the roast on reload.
        if (!('__TAURI_INTERNALS__' in window)) return;
        if (!isRoastRefreshBlocked(phase, awaitingNextCharge)) return;

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
    }, [phase, awaitingNextCharge]);

    const exitFullscreenHotkey = shortcutHotkeys(exitFullscreenKeys);

    // Escape → exit fullscreen (only when fullscreen and no modal open)
    useHotkeys(
        exitFullscreenHotkey,
        (e) => {
            e.preventDefault();
            onExitFullscreen();
        },
        { enabled: enabled && isFullscreen && exitFullscreenHotkey.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [enabled, isFullscreen, onExitFullscreen],
    );

    useBoundShortcut(
        fullscreenKeys,
        (e) => {
            e.preventDefault();
            onToggleFullscreen();
        },
        { enabled, preventDefault: true },
        [enabled, onToggleFullscreen],
    );

    const chargeFromShortcut = () => {
        if (phase === 'preheating') onEnterStandby();
        else if (phase === 'standby') onManualCharge();
    };

    useBoundShortcut(
        chargeKeys,
        (e) => {
            e.preventDefault();
            chargeFromShortcut();
        },
        { enabled: canCharge, enableOnFormTags: chargeEnabledOnFormTags, preventDefault: true },
        [canCharge, phase, onEnterStandby, onManualCharge],
    );

    useBoundShortcut(
        yellowKeys,
        (e) => {
            e.preventDefault();
            onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow');
        },
        { enabled: canMarkEvents, preventDefault: true },
        [canMarkEvents, onMarkEvent],
    );

    // Ctrl/Meta + 2 → Mark FC Start (or dual-mark cycle when onCycleFc provided)
    const markFcStart = () => {
        if (onCycleFc) onCycleFc();
        else onMarkEvent('FC Start', 'First crack started', 'Mark FC Start');
    };
    useBoundShortcut(
        fcStartKeys,
        (e) => {
            e.preventDefault();
            markFcStart();
        },
        { enabled: canMarkEvents, preventDefault: true },
        [canMarkEvents, onMarkEvent, onCycleFc],
    );

    useBoundShortcut(
        fcEndKeys,
        (e) => {
            e.preventDefault();
            onMarkEvent('FC End', 'First crack ended', 'Mark FC End');
        },
        { enabled: canMarkEvents, preventDefault: true },
        [canMarkEvents, onMarkEvent],
    );

    useBoundShortcut(
        dropKeys,
        (e) => {
            e.preventDefault();
            if (e.repeat) return;
            markDropFromShortcut();
        },
        { enabled: canMark, enableOnFormTags: dropEnabledOnFormTags, preventDefault: true },
        [canMark, markDropFromShortcut],
    );

    const canCloseSummary =
        shortcutsEnabled &&
        isRoastSummaryCloseShortcutEnabled({
            isActive,
            showSummaryModal,
            showEndRoastModal,
            showContinueModal,
            roastSummarySaving,
        });
    useBoundShortcut(
        closeSummaryKeys,
        (e) => {
            e.preventDefault();
            if (e.repeat) return;
            if (canCancelRoastSummary) onCancelRoastSummary?.();
            else onCloseRoastSummary?.();
        },
        {
            enabled: canCloseSummary && Boolean(onCloseRoastSummary || onCancelRoastSummary),
            enableOnFormTags: closeSummaryOnFormTags,
            preventDefault: true,
        },
        [canCloseSummary, canCancelRoastSummary, onCloseRoastSummary, onCancelRoastSummary],
    );

    const canReturnToChargeWait =
        shortcutsEnabled &&
        isRoastReturnToChargeWaitShortcutEnabled({
            isActive,
            reviewing,
            showEndRoastModal,
            showSummaryModal,
            showContinueModal,
            chargeLocked,
        });
    const returnOnFormTags = returnToChargeWaitKeys.every((key) => /^(?:mod|ctrl|alt)(?:\+|$)/.test(key));
    useBoundShortcut(
        returnToChargeWaitKeys,
        (e) => {
            e.preventDefault();
            if (e.repeat) return;
            onDismissReview?.();
        },
        {
            enabled: canReturnToChargeWait && Boolean(onDismissReview),
            enableOnFormTags: returnOnFormTags,
            preventDefault: true,
        },
        [canReturnToChargeWait, onDismissReview],
    );

    const customEvents = useRoastSettings().eventButtons.custom;
    const bindingList = useShortcutStore((state) => state.bindings);
    const customHotkeyPlan = useMemo(() => {
        const taken = SHORTCUTS.flatMap(({ id }) => bindingList[id]);
        const keys = effectiveCustomShortcuts(customEvents, taken);
        return { keys, bound: keys.filter((key): key is string => Boolean(key)) };
    }, [customEvents, bindingList]);
    useBoundShortcut(
        customHotkeyPlan.bound,
        (event) => {
            event.preventDefault();
            const pressed = eventToShortcut(event);
            const wanted = isDoubleShortcutEvent(event) ? doubleShortcut(pressed) : pressed;
            const index = customHotkeyPlan.keys.findIndex((key) => key != null && sameShortcut(key, wanted));
            const item = index >= 0 ? customEvents[index] : undefined;
            if (!item) return;
            onMarkEvent(item.name, '', item.id);
        },
        { enabled: canMarkEvents, preventDefault: true },
        [canMarkEvents, customEvents, customHotkeyPlan, onMarkEvent],
    );
};
