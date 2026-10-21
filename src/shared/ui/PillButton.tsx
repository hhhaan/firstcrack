import { cn } from '@shared/lib/cn';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    /** 좌측 아이콘 */
    icon?: ReactNode;
}

/** Primary action: 40px pill, inverted in dark mode. */
export const PillButton = ({ children, icon, className, type = 'button', ...props }: PillButtonProps) => (
    <button
        type={type}
        {...props}
        className={cn(
            'inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border-0 bg-action px-5 py-3 font-(--font-display) text-sm font-[550] leading-5 tracking-[0.14px] text-on-action transition-opacity duration-100 hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border disabled:pointer-events-none disabled:opacity-50',
            className,
        )}
    >
        {icon && <span className="flex items-center">{icon}</span>}
        {children}
    </button>
);
