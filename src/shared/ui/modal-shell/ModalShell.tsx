import { useModalStackStore } from '@shared/store/modalStack';
import { type MouseEvent, type PointerEvent, type ReactNode, type Ref, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalShellProps {
    ref?: Ref<HTMLDivElement>;
    children: ReactNode;
    onClose: () => void;
    labelledBy: string;
    overlayClassName?: string;
    contentClassName?: string;
    /**
     * When false, backdrop click does not call onClose (explicit actions only).
     * Default true — existing modals keep dismiss-on-overlay behavior.
     */
    dismissable?: boolean;
    /** Stable selector for e2e (dialog root). */
    'data-testid'?: string;
}

export const ModalShell = ({
    ref,
    children,
    onClose,
    labelledBy,
    overlayClassName,
    contentClassName,
    dismissable = true,
    'data-testid': testId,
}: ModalShellProps) => {
    // Chromium clicks the common ancestor when a press and a release land on different nodes.
    // A title selection that starts in the dialog and ends here would otherwise dismiss.
    const pointerDownOnBackdrop = useRef(false);
    const pointerUpOnBackdrop = useRef(false);

    useEffect(() => {
        useModalStackStore.getState().register();
        return () => useModalStackStore.getState().unregister();
    }, []);

    const trackPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        pointerUpOnBackdrop.current = false;
        pointerDownOnBackdrop.current = event.button === 0 && event.target === event.currentTarget;
    };

    const trackPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        pointerUpOnBackdrop.current = event.button === 0 && event.target === event.currentTarget;
    };

    const dismissFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        const pressedOnBackdrop = pointerDownOnBackdrop.current && pointerUpOnBackdrop.current;
        pointerDownOnBackdrop.current = false;
        pointerUpOnBackdrop.current = false;
        // detail 0 is HTMLElement.click() and other activations with no pointer gesture.
        if (event.detail === 0 || pressedOnBackdrop) onClose();
    };

    const overlay = (
        <div
            onPointerDownCapture={dismissable ? trackPointerDown : undefined}
            onPointerUpCapture={dismissable ? trackPointerUp : undefined}
            onClick={dismissable ? dismissFromBackdrop : undefined}
            role="presentation"
            className={`fixed inset-0 bg-[rgba(23,23,23,0.32)] backdrop-blur-sm flex items-center justify-center p-6 z-1000 ${overlayClassName ?? ''}`}
        >
            <div
                ref={ref}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                data-testid={testId}
                className={contentClassName}
            >
                {children}
            </div>
        </div>
    );
    // container-type / transform / filter ancestors become the containing block for
    // `fixed` and clip the dialog. Body keeps it viewport-relative. No SSR in this app;
    // the inline fallback is only for a document-less render.
    if (typeof document === 'undefined') return overlay;
    return createPortal(overlay, document.body);
};
