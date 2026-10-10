import { useEffect } from 'react';

const shouldDeferEscapeToField = (active: Element | null): boolean => {
    if (!active) return false;
    if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
    )
        return true;
    return active instanceof HTMLElement && active.isContentEditable;
};

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
            if (shouldDeferEscapeToField(document.activeElement)) return;
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
