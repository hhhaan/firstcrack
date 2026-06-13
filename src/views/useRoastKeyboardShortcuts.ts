import { useEffect } from 'react';
import { isEditableTarget } from '@shared/lib/dom';

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
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isActive) return;
            if (isEditableTarget(event.target) || showEndRoastModal || showSummaryModal) return;
            const shortcutModifier = event.metaKey || event.ctrlKey;

            if (event.key === 'Escape' && isFullscreen) {
                event.preventDefault();
                onExitFullscreen();
                return;
            }
            if (!shortcutModifier && event.code === 'KeyF') {
                event.preventDefault();
                onToggleFullscreen();
                return;
            }
            if (shortcutModifier && event.key === 'Enter') {
                event.preventDefault();
                if (phase === 'preheating') onEnterStandby();
                else if (phase === 'standby') onManualCharge();
                return;
            }
            if (!shortcutModifier) return;
            if (event.key === '1') {
                event.preventDefault();
                onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow');
                return;
            }
            if (event.key === '2') {
                event.preventDefault();
                onMarkEvent('FC Start', 'First crack started', 'Mark FC Start');
                return;
            }
            if (event.key === '3') {
                event.preventDefault();
                onMarkEvent('FC End', 'First crack ended', 'Mark FC End');
                return;
            }
            if (event.key === 'd') {
                event.preventDefault();
                onMarkDrop();
                return;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        isActive,
        isFullscreen,
        phase,
        showEndRoastModal,
        showSummaryModal,
        onToggleFullscreen,
        onExitFullscreen,
        onEnterStandby,
        onManualCharge,
        onMarkEvent,
        onMarkDrop,
    ]);
};
