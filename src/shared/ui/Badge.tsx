import { cn } from '@shared/lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Read-only status / category pill.
 * Not for selectable chips or buttons — use chipCls / PillButton for those.
 */
export type BadgeTone =
    | 'neutral' // surface + secondary (tags)
    | 'soft' // white/elevated inset (machine protocol tags)
    | 'good' // green
    | 'bad' // red
    | 'warn' // amber
    | 'amber' // sidebar count style
    | 'lavender'
    | 'lavenderSoft'
    | 'blue'
    | 'green'
    | 'yellow'
    | 'muted'; // skipped / low emphasis

const toneClass: Record<BadgeTone, string> = {
    neutral: 'text-secondary bg-surface dark:bg-surface-elevated',
    soft: 'text-secondary bg-white/80 dark:bg-surface-elevated shadow-(--shadow-inset)',
    good: 'text-palette-green bg-palette-green/15',
    bad: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-500/15',
    warn: 'text-amber-600 bg-amber-500/10 border border-amber-500/25',
    amber: 'text-amber-700 dark:text-amber-300 bg-amber-400/20',
    lavender: 'text-palette-lavender bg-palette-lavender/15 border border-palette-lavender/25',
    lavenderSoft: 'text-palette-lavender bg-palette-lavender/12',
    blue: 'text-palette-blue bg-palette-blue/12 border border-palette-blue/20',
    green: 'text-palette-green bg-palette-green/12 border border-palette-green/20',
    yellow: 'text-palette-yellow bg-palette-yellow/15',
    muted: 'text-palette-lavender bg-palette-lavender/10',
};

export type BadgeSize = 'sm' | 'md';

type BadgeProps = {
    children?: ReactNode;
    /** Named palette (ignored when color/bg set) */
    tone?: BadgeTone;
    /** Dynamic text color (roast level, stock cfg, …) */
    color?: string;
    /** Dynamic background */
    bg?: string;
    icon?: ReactNode;
    size?: BadgeSize;
    uppercase?: boolean;
    className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'color'>;

export const Badge = ({
    children,
    tone = 'neutral',
    color,
    bg,
    icon,
    size = 'md',
    uppercase = false,
    className,
    style,
    ...rest
}: BadgeProps) => {
    const custom = color != null || bg != null;

    return (
        <span
            {...rest}
            className={cn(
                'inline-flex items-center gap-0.5 font-medium rounded-full whitespace-nowrap tracking-[0.14px] shrink-0',
                size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5',
                uppercase && 'uppercase tracking-[0.4px] font-semibold',
                !custom && toneClass[tone],
                className,
            )}
            style={custom ? { color, background: bg, ...style } : style}
        >
            {icon}
            {children}
        </span>
    );
};
