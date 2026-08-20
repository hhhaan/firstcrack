import { cn } from '@shared/lib/cn';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type ModalHeaderProps = {
    title: ReactNode;
    titleId: string;
    onClose: () => void;
    closeLabel?: string;
    /** Optional subtitle under the title (e.g. edit context). */
    subtitle?: ReactNode;
    /** Left of the title block (back control, icon). */
    leading?: ReactNode;
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
    leading,
    className = '',
    titleClassName = 'font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0',
    closeClassName = defaultCloseCls,
}: ModalHeaderProps) {
    const titleBlock = (
        <div className="min-w-0">
            <h2 id={titleId} className={titleClassName}>
                {title}
            </h2>
            {subtitle}
        </div>
    );

    return (
        <div className={cn('flex items-center justify-between gap-3', className)}>
            {leading ? (
                <div className="flex min-w-0 items-center gap-3.5">
                    {leading}
                    {titleBlock}
                </div>
            ) : (
                titleBlock
            )}
            <button type="button" onClick={onClose} aria-label={closeLabel} className={closeClassName}>
                <X size={18} strokeWidth={2.3} />
            </button>
        </div>
    );
}
