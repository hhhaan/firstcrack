import { useHotkeys } from 'react-hotkeys-hook';

interface UseRoastKeyboardShortcutsParams {
    isActive: boolean;
    isFullscreen: boolean;
    showEndRoastModal: boolean;
    showSummaryModal: boolean;
    /** When true, block roast hotkeys while continue-batch modal is open. */
    showContinueModal?: boolean;
    phase: string;
    onToggleFullscreen: () => void;
    onExitFullscreen: () => void;
    onEnterStandby: () => void;
    onManualCharge: () => void;
    onMarkEvent: (event: string, note: string, pressKey: string) => void;
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
    return isRoastShortcutBaseEnabled(p) && p.phase === 'roasting';
}

export const useRoastKeyboardShortcuts = ({
    isActive,
    isFullscreen,
    showEndRoastModal,
    showSummaryModal,
    showContinueModal = false,
    phase,
    onToggleFullscreen,
    onExitFullscreen,
    onEnterStandby,
    onManualCharge,
    onMarkEvent,
    onMarkDrop,
}: UseRoastKeyboardShortcutsParams) => {
    const enabled = isRoastShortcutBaseEnabled({
        isActive,
        showEndRoastModal,
        showSummaryModal,
        showContinueModal,
    });
    const canMark = isRoastMarkShortcutEnabled({
        isActive,
        showEndRoastModal,
        showSummaryModal,
        showContinueModal,
        phase,
    });

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
        { enabled },
        [enabled, phase, onEnterStandby, onManualCharge],
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

    // Ctrl/Meta + 2 → Mark FC Start
    useHotkeys(
        'mod+2',
        (e) => {
            e.preventDefault();
            onMarkEvent('FC Start', 'First crack started', 'Mark FC Start');
        },
        { enabled: canMark },
        [canMark, onMarkEvent],
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
