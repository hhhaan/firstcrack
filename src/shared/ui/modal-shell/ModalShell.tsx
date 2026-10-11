import { useModalStackStore } from '@shared/store/modalStack';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalShellProps {
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
    children,
    onClose,
    labelledBy,
    overlayClassName,
    contentClassName,
    dismissable = true,
    'data-testid': testId,
}: ModalShellProps) => {
    useEffect(() => {
        useModalStackStore.getState().register();
        return () => useModalStackStore.getState().unregister();
    }, []);

    const overlay = (
        <div
            onClick={dismissable ? onClose : undefined}
            role="presentation"
            className={`fixed inset-0 bg-[rgba(23,23,23,0.32)] backdrop-blur-sm flex items-center justify-center p-6 z-1000 ${overlayClassName ?? ''}`}
        >
            <div
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
