import { effectiveCustomShortcuts } from '@features/active-roast/lib/event-buttons';
import { useRoastSettings } from '@features/active-roast/model/settings';
import { useGlobalRoastShortcuts } from '@features/active-roast/model/useGlobalRoastShortcuts';
import { i18n } from '@shared/i18n';
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
import { useEffect, useMemo } from 'react';
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
    const customEvents = useRoastSettings().eventButtons.custom;
    const bindingList = useShortcutStore((state) => state.bindings);
    const customHotkeyPlan = useMemo(() => {
        const taken = SHORTCUTS.flatMap(({ id }) => bindingList[id]);
        const keys = effectiveCustomShortcuts(customEvents, taken);
        return { keys, hotkeys: shortcutHotkeys(keys.filter((key): key is string => Boolean(key))) };
    }, [customEvents, bindingList]);
    const fireShortcut = useGlobalRoastShortcuts([
        {
            id: 'charge',
            keys: chargeKeys,
            enabled: canCharge,
            enableOnFormTags: chargeEnabledOnFormTags,
            onFire: () => {
                if (phase === 'preheating') onEnterStandby();
                else if (phase === 'standby') onManualCharge();
            },
        },
        {
            id: 'yellow',
            keys: yellowKeys,
            enabled: canMarkEvents,
            global: canMark,
            onFire: () => onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow'),
        },
        {
            id: 'fcStart',
            keys: fcStartKeys,
            enabled: canMarkEvents,
            global: canMark,
            onFire: () => {
                if (onCycleFc) onCycleFc();
                else onMarkEvent('FC Start', 'First crack started', 'Mark FC Start');
            },
        },
        {
            id: 'fcEnd',
            keys: fcEndKeys,
            enabled: canMarkEvents,
            global: canMark,
            onFire: () => onMarkEvent('FC End', 'First crack ended', 'Mark FC End'),
        },
        { id: 'drop', keys: dropKeys, enabled: canMark, enableOnFormTags: dropEnabledOnFormTags, onFire: onMarkDrop },
        ...customEvents.map((item, index) => ({
            id: `custom:${item.id}`,
            keys: customHotkeyPlan.keys[index] ? [customHotkeyPlan.keys[index]] : [],
            enabled: canMarkEvents,
            global: canMark,
            onFire: () => onMarkEvent(item.name, '', item.id),
        })),
    ]);

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

    // Escape → exit fullscreen (only when fullscreen and no modal open)
    useHotkeys(
        shortcutHotkeys(exitFullscreenKeys),
        (e) => {
            e.preventDefault();
            onExitFullscreen();
        },
        { enabled: enabled && isFullscreen && exitFullscreenKeys.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [enabled, isFullscreen, onExitFullscreen],
    );

    // F → toggle fullscreen (case-insensitive — library normalises via toLowerCase)
    useHotkeys(
        shortcutHotkeys(fullscreenKeys),
        (e) => {
            e.preventDefault();
            onToggleFullscreen();
        },
        { enabled: enabled && fullscreenKeys.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [enabled, onToggleFullscreen],
    );

    // Ctrl/Meta + Enter → enter standby or charge
    useHotkeys(
        shortcutHotkeys(chargeKeys),
        (e) => {
            e.preventDefault();
            if (!e.repeat) fireShortcut('charge');
        },
        {
            enabled: canCharge && chargeKeys.length > 0,
            enableOnFormTags: chargeEnabledOnFormTags,
            ...SHORTCUT_HOTKEY_OPTIONS,
        },
        [canCharge, fireShortcut],
    );

    // Ctrl/Meta + 1 → Mark Yellow
    useHotkeys(
        shortcutHotkeys(yellowKeys),
        (e) => {
            e.preventDefault();
            if (!e.repeat) fireShortcut('yellow');
        },
        { enabled: canMarkEvents && yellowKeys.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [canMarkEvents, fireShortcut],
    );

    // Ctrl/Meta + 2 → Mark FC Start (or dual-mark cycle when onCycleFc provided)
    useHotkeys(
        shortcutHotkeys(fcStartKeys),
        (e) => {
            e.preventDefault();
            if (!e.repeat) fireShortcut('fcStart');
        },
        { enabled: canMarkEvents && fcStartKeys.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [canMarkEvents, fireShortcut],
    );

    // Ctrl/Meta + 3 → Mark FC End
    useHotkeys(
        shortcutHotkeys(fcEndKeys),
        (e) => {
            e.preventDefault();
            if (!e.repeat) fireShortcut('fcEnd');
        },
        { enabled: canMarkEvents && fcEndKeys.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [canMarkEvents, fireShortcut],
    );

    // Ctrl/Meta + Shift + D → Mark Drop. Stays on while the OS hotkey is held; the shared
    // dedupe drops the second delivery of the same press.
    useHotkeys(
        shortcutHotkeys(dropKeys),
        (e) => {
            e.preventDefault();
            if (e.repeat) return;
            fireShortcut('drop');
        },
        {
            enabled: canMark && dropKeys.length > 0,
            enableOnFormTags: dropEnabledOnFormTags,
            ...SHORTCUT_HOTKEY_OPTIONS,
        },
        [canMark, fireShortcut],
    );

    useHotkeys(
        customHotkeyPlan.hotkeys,
        (event) => {
            event.preventDefault();
            if (event.repeat) return;
            const pressed = eventToShortcut(event);
            const index = customHotkeyPlan.keys.findIndex((key) => key != null && sameShortcut(key, pressed));
            const item = index >= 0 ? customEvents[index] : undefined;
            if (!item) return;
            fireShortcut(`custom:${item.id}`);
        },
        { enabled: canMarkEvents && customHotkeyPlan.hotkeys.length > 0, ...SHORTCUT_HOTKEY_OPTIONS },
        [canMarkEvents, customEvents, customHotkeyPlan, fireShortcut],
    );
};
