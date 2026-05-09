import { type ReactNode } from 'react';

interface ModalShellProps {
    children: ReactNode;
    onClose: () => void;
    labelledBy: string;
    overlayClassName?: string;
    contentClassName?: string;
}

export const ModalShell = ({ children, onClose, labelledBy, overlayClassName, contentClassName }: ModalShellProps) => {
    return (
        <div
            onClick={onClose}
            role="presentation"
            className={`fixed inset-0 bg-[rgba(23,23,23,0.32)] backdrop-blur-sm flex items-center justify-center p-6 z-1000 ${overlayClassName ?? ''}`}
        >
            <div
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                className={contentClassName}
            >
                {children}
            </div>
        </div>
    );
};
