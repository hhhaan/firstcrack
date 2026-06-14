import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
    label: string;
    value: string;
    change: string;
    icon: LucideIcon;
}

export const KpiCard = ({ label, value, change, icon: Icon }: KpiCardProps) => {
    const isPositive = change.startsWith('+');
    const isNeutral = change === '';

    return (
        <div className="bg-main-bg rounded-lg px-5 pt-5 pb-4.5">
            <div className="flex items-start justify-between mb-3.5">
                <div className="w-8.5 h-8.5 rounded-lg bg-surface flex items-center justify-center">
                    <Icon size={16} strokeWidth={1.5} color="var(--color-secondary)" />
                </div>
                {!isNeutral && (
                    <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full tracking-[0.14px] ${
                            isPositive
                                ? 'text-green-600 bg-[rgba(220,252,231,0.8)]'
                                : 'text-red-600 bg-[rgba(254,226,226,0.8)]'
                        }`}
                    >
                        {change}
                    </span>
                )}
            </div>
            <div className="text-[26px] font-semibold text-primary leading-[1.2] mb-1 tracking-[-0.5px]">
                {value}
            </div>
            <div className="text-[13px] text-muted tracking-[0.14px]">{label}</div>
        </div>
    );
};