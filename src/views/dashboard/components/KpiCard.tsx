import { cn } from '@shared/lib/cn';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface KpiCardProps {
    label: string;
    value: string;
    change: string;
    unit?: string;
    caption: string;
    comparison: string;
    className?: string;
    children: ReactNode;
    onRefresh?: () => void;
    refreshing?: boolean;
}

export const KpiCard = ({
    label,
    value,
    change,
    unit,
    caption,
    comparison,
    className,
    children,
    onRefresh,
    refreshing,
}: KpiCardProps) => {
    const { t } = useTranslation();

    return (
        <section className={cn('flex min-w-0 flex-col p-6 lg:p-8', className)}>
            <div className="mb-4 flex min-h-6 items-center justify-between gap-3">
                <h2 className="text-base font-[450] leading-6 tracking-[0.24px] text-primary">{label}</h2>
                {onRefresh && (
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="flex size-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t('dashboard.refresh')}
                    >
                        <RefreshCw size={13} strokeWidth={1.5} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                )}
            </div>
            <div className="flex min-h-14 items-baseline gap-2">
                <span className="text-3xl font-[450] leading-9 tracking-[0.24px] text-primary xl:text-5xl xl:font-[350] xl:leading-12">
                    {value}
                </span>
                {unit && <span className="text-sm text-muted">{unit}</span>}
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span className="size-2 rounded-full border-[1.5px] border-palette-blue" aria-hidden="true" />
                {caption}
            </p>
            <p className="mt-2 min-h-4 text-[11px] text-muted">
                {change && (
                    <>
                        <span className="font-medium text-secondary">{change}</span> {comparison}
                    </>
                )}
            </p>
            <div className="mt-5 flex-1">{children}</div>
        </section>
    );
};
