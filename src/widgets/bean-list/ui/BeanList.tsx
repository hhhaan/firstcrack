import { getStatus, statusConfig, stockBarClass, stockLevelPct } from '@entities/bean/lib';
import type { BeanAssetLine, StockSummary } from '@entities/bean-stock-event';
import type { Bean } from '@shared/types/database.types';
import { Badge } from '@shared/ui/Badge';
import { CatalogVisibilityButton } from '@shared/ui/CatalogVisibilityControls';
import { currencySymbol, formatAmount } from '@widgets/cost-calculator/lib/format';
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
    assetByBeanId?: Record<string, BeanAssetLine>;
    assetsReady?: boolean;
    hidden?: ReadonlySet<string>;
    onToggleHidden?: (id: string) => void;
}

const Skeleton = () => (
    <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-main-bg rounded-2xl border border-border px-4 py-3.5">
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

export const BeanList = ({
    beans,
    isLoading,
    onSelect,
    search,
    onSearchChange,
    stockSummaries,
    assetByBeanId = {},
    assetsReady = false,
    hidden,
    onToggleHidden,
}: BeanListProps) => {
    const { t, i18n } = useTranslation();
    const searchLower = search.toLowerCase();
    const filtered = beans.filter(
        (b) => b.name.toLowerCase().includes(searchLower) || (b.origin ?? '').toLowerCase().includes(searchLower),
    );

    return (
        <div>
            <div className="mb-2.5 flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 dark:bg-surface-elevated">
                <Search size={14} strokeWidth={2} className="shrink-0 text-muted" />
                <input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={t('beanList.searchPlaceholder')}
                    className="w-full border-none bg-transparent font-body text-[13px] tracking-[0.14px] text-primary outline-none"
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
                        const pct = stockLevelPct(currentGrams, bean.capacity_grams);
                        const asset = assetsReady ? assetByBeanId[bean.id] : undefined;
                        const showAssetMeta = asset && asset.valuedGrams > 0;

                        return (
                            <div
                                key={bean.id}
                                data-testid={`bean-list-item-${bean.id}`}
                                data-stock-kg={(currentGrams / 1000).toFixed(2)}
                                onClick={() => onSelect(bean.id)}
                                className="cursor-pointer rounded-2xl border border-border bg-main-bg px-4 py-3.5 transition-colors duration-150"
                            >
                                <div className="mb-2 flex items-start justify-between">
                                    <div>
                                        <div className="mb-0.5 text-[13px] font-medium tracking-[0.14px] text-primary">
                                            {bean.name}
                                        </div>
                                        <div className="text-xs tracking-[0.14px] text-muted">
                                            {bean.origin ?? '—'} · {bean.process ?? '—'}
                                        </div>
                                    </div>
                                    {onToggleHidden && (
                                        <CatalogVisibilityButton
                                            hidden={hidden?.has(bean.id) ?? false}
                                            name={bean.name}
                                            onToggle={() => onToggleHidden(bean.id)}
                                        />
                                    )}
                                    <Badge color={cfg.color} bg={cfg.bg} className="ml-2 px-[7px]">
                                        {cfg.label}
                                    </Badge>
                                </div>

                                <div className="mb-1 h-1 overflow-hidden rounded-full bg-surface">
                                    <div
                                        className={`h-full rounded-full ${stockBarClass[status]}`}
                                        style={{
                                            width: `${pct}%`,
                                            transition: 'width 0.5s',
                                        }}
                                    />
                                </div>
                                <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
                                    <span className="text-muted">
                                        {(currentGrams / 1000).toFixed(2)}kg / {(bean.capacity_grams / 1000).toFixed(2)}
                                        kg
                                    </span>
                                    {showAssetMeta &&
                                        (asset.assetValue != null ? (
                                            <span className="shrink-0 text-secondary">
                                                {currencySymbol(i18n.language)}
                                                {formatAmount(asset.assetValue, i18n.language)}
                                            </span>
                                        ) : asset.costSource === 'none' ? (
                                            <span className="shrink-0 text-muted">—</span>
                                        ) : null)}
                                </div>
                            </div>
                        );
                    })}

                    {filtered.length === 0 && (
                        <div className="px-5 py-10 text-center text-sm tracking-[0.14px] text-muted">
                            {beans.length === 0 ? t('beanList.empty') : t('beanList.noResults')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
