import { useHotkeys } from 'react-hotkeys-hook';

interface UseRoastKeyboardShortcutsParams {
    isActive: boolean;
    isFullscreen: boolean;
    showEndRoastModal: boolean;
    showSummaryModal: boolean;
    phase: string;
    onToggleFullscreen: () => void;
    onExitFullscreen: () => void;
    onEnterStandby: () => void;
    onManualCharge: () => void;
    onMarkEvent: (event: string, note: string, pressKey: string) => void;
    onMarkDrop: () => void;
}

export const useRoastKeyboardShortcuts = ({
    isActive,
    isFullscreen,
    showEndRoastModal,
    showSummaryModal,
    phase,
    onToggleFullscreen,
    onExitFullscreen,
    onEnterStandby,
    onManualCharge,
    onMarkEvent,
    onMarkDrop,
}: UseRoastKeyboardShortcutsParams) => {
    const enabled = isActive && !showEndRoastModal && !showSummaryModal;

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
        { enabled },
        [enabled, onMarkEvent],
    );

    // Ctrl/Meta + 2 → Mark FC Start
    useHotkeys(
        'mod+2',
        (e) => {
            e.preventDefault();
            onMarkEvent('FC Start', 'First crack started', 'Mark FC Start');
        },
        { enabled },
        [enabled, onMarkEvent],
    );

    // Ctrl/Meta + 3 → Mark FC End
    useHotkeys(
        'mod+3',
        (e) => {
            e.preventDefault();
            onMarkEvent('FC End', 'First crack ended', 'Mark FC End');
        },
        { enabled },
        [enabled, onMarkEvent],
    );

    // Ctrl/Meta + D → Mark Drop (case-insensitive)
    useHotkeys(
        'mod+d',
        (e) => {
            e.preventDefault();
            onMarkDrop();
        },
        { enabled },
        [enabled, onMarkDrop],
    );
};
