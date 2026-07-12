import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type ModalHeaderProps = {
    title: ReactNode;
    titleId: string;
    onClose: () => void;
    closeLabel?: string;
    /** Optional subtitle under the title (e.g. edit context). */
    subtitle?: ReactNode;
    className?: string;
    titleClassName?: string;
    closeClassName?: string;
};

const defaultCloseCls =
    'w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all hover:text-primary shrink-0';

/**
 * Title row + close control. Put chrome (border/bg) on `className`.
 */
export function ModalHeader({
    title,
    titleId,
    onClose,
    closeLabel = 'Close',
    subtitle,
    className = '',
    titleClassName = 'font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0',
    closeClassName = defaultCloseCls,
}: ModalHeaderProps) {
    return (
        <div className={`flex items-center justify-between gap-3 ${className}`.trim()}>
            <div className="min-w-0">
                <h2 id={titleId} className={titleClassName}>
                    {title}
                </h2>
                {subtitle}
            </div>
            <button type="button" onClick={onClose} aria-label={closeLabel} className={closeClassName}>
                <X size={18} strokeWidth={2.3} />
            </button>
        </div>
    );
}
