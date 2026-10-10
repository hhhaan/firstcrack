import { useEffect } from 'react';

export const useTopmostDialogEscapeKey = (options: {
    enabled: boolean;
    dialogTestId: string;
    onEscape: () => void;
}) => {
    const { enabled, dialogTestId, onEscape } = options;
    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
            const active = document.activeElement;
            if (active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
            const dialogs = document.querySelectorAll('[role="dialog"]');
            const dialog = document.querySelector(`[data-testid="${dialogTestId}"]`);
            if (!dialog || dialogs[dialogs.length - 1] !== dialog) return;
            event.preventDefault();
            onEscape();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [enabled, dialogTestId, onEscape]);
};
