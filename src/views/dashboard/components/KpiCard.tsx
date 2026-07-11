import { Badge, type BadgeTone } from '@shared/ui/Badge';
import type { LucideIcon } from 'lucide-react';
import { RefreshCw } from 'lucide-react';

interface KpiCardProps {
    label: string;
    value: string;
    change: string;
    icon: LucideIcon;
    onRefresh?: () => void;
    refreshing?: boolean;
}

export const KpiCard = ({ label, value, change, icon: Icon, onRefresh, refreshing }: KpiCardProps) => {
    const isPositive = change.startsWith('+');
    const isNegative = change.startsWith('-');
    const isNeutral = change === '';

    let changeTone: BadgeTone = 'neutral';
    if (isPositive) changeTone = 'good';
    else if (isNegative) changeTone = 'bad';

    return (
        <div className="bg-main-bg rounded-lg px-5 pt-5 pb-4.5 dark:border dark:border-border">
            <div className="flex items-start justify-between mb-3.5">
                <div className="w-8.5 h-8.5 rounded-lg bg-surface dark:bg-surface-elevated flex items-center justify-center">
                    <Icon size={16} strokeWidth={1.5} className="text-secondary" />
                </div>
                {!isNeutral && (
                    <Badge tone={changeTone} className="text-xs">
                        {change}
                    </Badge>
                )}
            </div>
            <div className="text-[26px] font-semibold text-primary leading-[1.2] mb-1 tracking-[-0.5px]">{value}</div>
            <div className="flex items-center justify-between">
                <div className="text-[13px] text-muted tracking-[0.14px]">{label}</div>
                {onRefresh && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRefresh();
                        }}
                        disabled={refreshing}
                        className="size-5 flex items-center justify-center rounded hover:bg-surface dark:hover:bg-surface-elevated text-muted hover:text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Refresh"
                    >
                        <RefreshCw size={12} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                )}
            </div>
        </div>
    );
};
