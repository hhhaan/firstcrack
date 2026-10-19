import { cn } from '@shared/lib/cn';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface SurfaceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    /** Leading icon */
    icon?: ReactNode;
}

/** Compact secondary action: 32px pill with a faint border. */
export const SurfaceButton = ({ children, icon, className = '', type = 'button', ...props }: SurfaceButtonProps) => (
    <button
        type={type}
        className={cn(
            'inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-action/4 bg-surface px-3 py-1.5 font-(--font-display) text-xs font-[550] leading-4 text-action transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border disabled:pointer-events-none disabled:opacity-50 dark:border-action/5',
            className,
        )}
        {...props}
    >
        {icon != null ? <span className="flex items-center">{icon}</span> : null}
        {children}
    </button>
);
