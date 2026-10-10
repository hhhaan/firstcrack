import { useEffect } from 'react';

/** Capture-phase Escape on nested confirms so parent modals do not receive the key. */
export const useCaptureEscapeDismiss = (active: boolean, onDismiss: () => void) => {
    useEffect(() => {
        if (!active) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            onDismiss();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [active, onDismiss]);
};
