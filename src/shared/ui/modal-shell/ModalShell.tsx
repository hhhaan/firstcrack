import { type CSSProperties, type ReactNode } from 'react';

interface ModalShellProps {
    children: ReactNode;
    onClose: () => void;
    labelledBy: string;
    overlayClassName?: string;
    contentStyle?: CSSProperties;
}

export const ModalShell = ({ children, onClose, labelledBy, overlayClassName, contentStyle }: ModalShellProps) => {
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
                style={contentStyle}
            >
                {children}
            </div>
        </div>
    );
};
