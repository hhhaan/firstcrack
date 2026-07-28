import type { BadgeTone } from '@shared/ui/Badge';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const ghostBtn =
    'inline-flex items-center justify-center gap-1.5 rounded-full border border-border-subtle bg-transparent px-3 py-1.5 text-[12px] font-medium tracking-[0.14px] text-secondary transition-colors hover:bg-surface hover:text-primary disabled:pointer-events-none disabled:opacity-40 dark:border-[#585d61] dark:hover:bg-surface-elevated cursor-pointer';

export const iconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-primary disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-surface-elevated cursor-pointer';

export const dangerIconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40 cursor-pointer';

export function GhostButton({
    className = '',
    children,
    type = 'button',
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
    return (
        <button type={type} className={`${ghostBtn} ${className}`} {...props}>
            {children}
        </button>
    );
}

export function EmptyState({ icon, message, action }: { icon: ReactNode; message: string; action?: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-16 text-center dark:border-[#585d61]">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-muted dark:bg-surface-elevated">
                {icon}
            </div>
            <p className="max-w-sm text-[13px] leading-relaxed text-muted tracking-[0.14px]">{message}</p>
            {action}
        </div>
    );
}

export function orderStatusTone(status: string, fulfilled: boolean): BadgeTone {
    if (status === 'cancelled' || status === 'refunded') return 'bad';
    if (fulfilled) return 'good';
    switch (status) {
        case 'paid':
        case 'preparing':
            return 'blue';
        case 'shipped':
        case 'delivered':
            return 'green';
        case 'pending':
            return 'muted';
        default:
            return 'neutral';
    }
}

export function channelStatusTone(status: string): BadgeTone {
    switch (status) {
        case 'active':
            return 'good';
        case 'error':
            return 'bad';
        case 'pending':
            return 'warn';
        case 'disabled':
            return 'muted';
        default:
            return 'neutral';
    }
}

export function dispatchTone(status: string, delayed: boolean): BadgeTone {
    if (delayed) return 'warn';
    switch (status) {
        case 'confirmed':
            return 'good';
        case 'sent':
            return 'blue';
        case 'failed':
            return 'bad';
        default:
            return 'muted';
    }
}
