import { isEscapeKeyConsumed, markEscapeKeyConsumed } from '@shared/ui/modal-shell/dialogEscape';
import { useDocumentEscapeCapture } from '@shared/ui/modal-shell/useDocumentEscapeCapture';

/** Capture-phase Escape on nested confirms so parent modals do not receive the key. */
export const useCaptureEscapeDismiss = (active: boolean, onDismiss: () => void) => {
    useDocumentEscapeCapture(active, (event) => {
        if (event.key !== 'Escape' || event.isComposing || isEscapeKeyConsumed(event)) return;
        markEscapeKeyConsumed(event);
        event.stopImmediatePropagation();
        onDismiss();
    });
};
