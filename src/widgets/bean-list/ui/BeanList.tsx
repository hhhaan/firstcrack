import { getStatus, statusConfig } from '@entities/bean/lib';
import type { StockSummary } from '@entities/bean-stock-event';
import type { Bean } from '@shared/types/database.types';
import { Badge } from '@shared/ui/Badge';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface BeanListProps {
    beans: Bean[];
    isLoading: boolean;
    selectedId: string | null;
    onSelect: (id: string) => void;
    search: string;
    onSearchChange: (value: string) => void;
    stockSummaries: Record<string, StockSummary>;
}

const Skeleton = () => (
    <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-main-bg rounded-lg px-4 py-3.5 border border-[#E5E5E5] dark:border-[#585d61]">
                <div className="flex justify-between mb-2.5">
                    <div>
                        <div className="w-35 h-3 rounded-md bg-surface mb-1.5 animate-pulse" />
                        <div className="w-22 h-2.75 rounded-md bg-surface animate-pulse" />
                    </div>
                    <div className="w-14 h-5 rounded-full bg-surface animate-pulse" />
                </div>
                <div className="h-1 rounded-full bg-surface mb-1 animate-pulse" />
                <div className="w-20 h-2.75 rounded-md bg-surface animate-pulse" />
            </div>
        ))}
    </div>
);

export const BeanList = ({ beans, isLoading, onSelect, search, onSearchChange, stockSummaries }: BeanListProps) => {
    const { t } = useTranslation();
    const searchLower = search.toLowerCase();
    const filtered = beans.filter(
        (b) => b.name.toLowerCase().includes(searchLower) || (b.origin ?? '').toLowerCase().includes(searchLower),
    );

    return (
        <div>
            <div className="flex items-center gap-2 bg-main-bg rounded-lg px-3 py-[9px] mb-2.5 dark:border dark:border-[#585d61]">
                <Search size={14} strokeWidth={2} className="text-muted shrink-0" />
                <input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={t('beanList.searchPlaceholder')}
                    className="border-none bg-transparent outline-none text-[13px] text-primary font-body w-full tracking-[0.14px]"
                />
            </div>

            {isLoading ? (
                <Skeleton />
            ) : (
                <div className="flex flex-col gap-2">
                    {filtered.map((bean) => {
                        const summary = stockSummaries[bean.id];
                        const currentGrams = summary?.currentGrams ?? 0;
                        const status = getStatus(currentGrams, bean.low_stock_threshold_grams);
                        const cfg = statusConfig[status];
                        const pct = Math.min(100, (currentGrams / bean.capacity_grams) * 100);

                        return (
                            <div
                                key={bean.id}
                                onClick={() => onSelect(bean.id)}
                                className="bg-main-bg rounded-lg px-4 py-3.5 cursor-pointer transition-all duration-150 border border-[#E5E5E5] dark:border-[#585d61]"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div>
                                        <div className="text-[13px] font-medium text-primary tracking-[0.14px] mb-0.5">
                                            {bean.name}
                                        </div>
                                        <div className="text-xs text-muted tracking-[0.14px]">
                                            {bean.origin ?? '—'} · {bean.process ?? '—'}
                                        </div>
                                    </div>
                                    <Badge color={cfg.color} bg={cfg.bg} className="ml-2 px-[7px]">
                                        {cfg.label}
                                    </Badge>
                                </div>

                                <div className="h-1 bg-surface rounded-full overflow-hidden mb-1">
                                    <div
                                        className="h-full rounded-full bg-palette-green"
                                        style={{
                                            width: `${pct}%`,
                                            transition: 'width 0.5s',
                                        }}
                                    />
                                </div>
                                <div className="text-xs text-muted font-mono">
                                    {(currentGrams / 1000).toFixed(2)}kg / {(bean.capacity_grams / 1000).toFixed(2)}kg
                                </div>
                            </div>
                        );
                    })}

                    {filtered.length === 0 && (
                        <div className="px-5 py-10 text-center text-muted text-sm tracking-[0.14px]">
                            {beans.length === 0 ? t('beanList.empty') : t('beanList.noResults')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
