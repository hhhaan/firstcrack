import { effectiveCustomShortcuts } from '@features/active-roast/lib/event-buttons';
import { useRoastSettings } from '@features/active-roast/model/settings';
import { useGlobalDropShortcut } from '@features/active-roast/model/useGlobalDropShortcut';
import { i18n } from '@shared/i18n';
import { doubleShortcut } from '@shared/lib/shortcut-key';
import { useDoubleShortcut } from '@shared/lib/useDoubleShortcut';
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
    const chargeEnabledOnFormTags = chargeKeys.every((key) => /^(?:mod|ctrl|alt)(?:\+|$)/.test(key));
    const dropEnabledOnFormTags = dropKeys.every((key) => /^(?:mod|ctrl|alt)(?:\+|$)/.test(key));
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
    const fullscreenHotkey = shortcutHotkeys(fullscreenKeys);
    const chargeHotkey = shortcutHotkeys(chargeKeys);
    const yellowHotkey = shortcutHotkeys(yellowKeys);
    const fcStartHotkey = shortcutHotkeys(fcStartKeys);
    const fcEndHotkey = shortcutHotkeys(fcEndKeys);
    const dropHotkey = shortcutHotkeys(dropKeys);

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

    // F → toggle fullscreen (case-insensitive — library normalises via toLowerCase)
    useHotkeys(
        fullscreenHotkey,
        (e) => {
            e.preventDefault();
            onToggleFullscreen();
        },
        { enabled: enabled && fullscreenHotkey.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [enabled, onToggleFullscreen],
    );
    useDoubleShortcut(fullscreenKeys, () => onToggleFullscreen(), { enabled });

    const chargeFromShortcut = () => {
        if (phase === 'preheating') onEnterStandby();
        else if (phase === 'standby') onManualCharge();
    };

    // Ctrl/Meta + Enter → enter standby or charge
    useHotkeys(
        chargeHotkey,
        (e) => {
            e.preventDefault();
            chargeFromShortcut();
        },
        {
            enabled: canCharge && chargeHotkey.length > 0,
            enableOnFormTags: chargeEnabledOnFormTags,
            ...SHORTCUT_HOTKEY_OPTIONS,
        },
        [canCharge, phase, onEnterStandby, onManualCharge],
    );
    useDoubleShortcut(chargeKeys, () => chargeFromShortcut(), {
        enabled: canCharge,
        enableOnFormTags: chargeEnabledOnFormTags,
    });

    // Ctrl/Meta + 1 → Mark Yellow
    useHotkeys(
        yellowHotkey,
        (e) => {
            e.preventDefault();
            onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow');
        },
        { enabled: canMarkEvents && yellowHotkey.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [canMarkEvents, onMarkEvent],
    );
    useDoubleShortcut(yellowKeys, () => onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow'), {
        enabled: canMarkEvents,
    });

    // Ctrl/Meta + 2 → Mark FC Start (or dual-mark cycle when onCycleFc provided)
    const markFcStart = () => {
        if (onCycleFc) onCycleFc();
        else onMarkEvent('FC Start', 'First crack started', 'Mark FC Start');
    };
    useHotkeys(
        fcStartHotkey,
        (e) => {
            e.preventDefault();
            markFcStart();
        },
        { enabled: canMarkEvents && fcStartHotkey.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [canMarkEvents, onMarkEvent, onCycleFc],
    );
    useDoubleShortcut(fcStartKeys, () => markFcStart(), { enabled: canMarkEvents });

    // Ctrl/Meta + 3 → Mark FC End
    useHotkeys(
        fcEndHotkey,
        (e) => {
            e.preventDefault();
            onMarkEvent('FC End', 'First crack ended', 'Mark FC End');
        },
        { enabled: canMarkEvents && fcEndHotkey.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [canMarkEvents, onMarkEvent],
    );
    useDoubleShortcut(fcEndKeys, () => onMarkEvent('FC End', 'First crack ended', 'Mark FC End'), {
        enabled: canMarkEvents,
    });

    // Ctrl/Meta + Shift + D → Mark Drop. Stays on while the OS hotkey is held; the shared
    // dedupe drops the second delivery of the same press. A double fires only on the second press,
    // from here and from the OS hook, and the same dedupe collapses that pair.
    useHotkeys(
        dropHotkey,
        (e) => {
            e.preventDefault();
            if (e.repeat) return;
            markDropFromShortcut();
        },
        {
            enabled: canMark && dropHotkey.length > 0,
            enableOnFormTags: dropEnabledOnFormTags,
            ...SHORTCUT_HOTKEY_OPTIONS,
        },
        [canMark, markDropFromShortcut],
    );
    useDoubleShortcut(
        dropKeys,
        () => {
            markDropFromShortcut();
        },
        { enabled: canMark, enableOnFormTags: dropEnabledOnFormTags },
    );

    const customEvents = useRoastSettings().eventButtons.custom;
    const bindingList = useShortcutStore((state) => state.bindings);
    const customHotkeyPlan = useMemo(() => {
        const taken = SHORTCUTS.flatMap(({ id }) => bindingList[id]);
        const keys = effectiveCustomShortcuts(customEvents, taken);
        return { keys, hotkeys: shortcutHotkeys(keys.filter((key): key is string => Boolean(key))) };
    }, [customEvents, bindingList]);
    useHotkeys(
        customHotkeyPlan.hotkeys,
        (event) => {
            event.preventDefault();
            const pressed = eventToShortcut(event);
            const index = customHotkeyPlan.keys.findIndex((key) => key != null && sameShortcut(key, pressed));
            const item = index >= 0 ? customEvents[index] : undefined;
            if (!item) return;
            onMarkEvent(item.name, '', item.id);
        },
        { enabled: canMarkEvents && customHotkeyPlan.hotkeys.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [canMarkEvents, customEvents, customHotkeyPlan, onMarkEvent],
    );
    useDoubleShortcut(
        customHotkeyPlan.keys.filter((key): key is string => Boolean(key)),
        (event) => {
            const pressed = doubleShortcut(eventToShortcut(event));
            const index = customHotkeyPlan.keys.findIndex((key) => key != null && sameShortcut(key, pressed));
            const item = index >= 0 ? customEvents[index] : undefined;
            if (!item) return;
            onMarkEvent(item.name, '', item.id);
        },
        { enabled: canMarkEvents },
    );
};
