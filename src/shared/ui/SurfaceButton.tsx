import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface SurfaceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    /** Leading icon */
    icon?: ReactNode;
}

/**
 * Soft surface CTA — schedule “add batch”, empty-state actions, secondary page adds.
 * rounded-lg + bg-surface (not primary black PillButton).
 */
export const SurfaceButton = ({ children, icon, className = '', type = 'button', ...props }: SurfaceButtonProps) => (
    <button
        type={type}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-[13px] font-medium text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 dark:bg-surface-elevated cursor-pointer ${className}`}
        {...props}
    >
        {icon != null ? <span className="flex items-center">{icon}</span> : null}
        {children}
    </button>
);
