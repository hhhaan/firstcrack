import { getStatus, processColor, stockBarClass, stockLevelPct } from '@entities/bean/lib';
import { type BeanAssetLine, useBeanStockEvents, useBeanStockSummary } from '@entities/bean-stock-event';
import { isOptimisticId } from '@shared/lib/optimistic-id';
import type { Bean } from '@shared/types/database.types';
import { Badge } from '@shared/ui/Badge';
import { currencySymbol, formatAmount } from '@widgets/cost-calculator/lib/format';
import { Edit3, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DeleteBeanModal } from './DeleteBeanModal';

const EVENT_TYPE_LABEL_KEY: Record<string, string> = {
    purchase: 'beanDetail.stockHistory.purchase',
    roast: 'beanDetail.stockHistory.roast',
    write_off: 'beanDetail.stockHistory.writeOff',
};

interface BeanDetailProps {
    bean: Bean | null;
    hasAny: boolean;
    isLoading: boolean;
    affectedBlendNames: string[];
    assetLine?: BeanAssetLine | null;
    onEdit: (bean: Bean) => void;
    onRestock: (id: string) => void;
    onStartRoast: () => void;
    onDelete: (id: string) => void;
}

const Skeleton = () => (
    <div className="bg-main-bg rounded-2xl border border-border px-8 py-7">
        <div className="mb-6">
            <div className="w-50 h-8 rounded-lg bg-surface mb-2.5 animate-pulse" />
            <div className="flex gap-1.5">
                <div className="w-15 h-5.5 rounded-full bg-surface animate-pulse" />
                <div className="w-20 h-5.5 rounded-full bg-surface animate-pulse" />
            </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                    <div className="w-12.5 h-2.5 rounded bg-surface mb-1.5 animate-pulse" />
                    <div className="w-25 h-3.5 rounded-md bg-surface animate-pulse" />
                </div>
            ))}
        </div>
        <div className="h-1.5 rounded-full bg-surface mb-6 animate-pulse" />
        <div className="flex gap-2.5">
            <div className="flex-1 h-10 rounded-full bg-surface animate-pulse" />
            <div className="flex-1 h-10 rounded-full bg-surface animate-pulse" />
        </div>
    </div>
);

const Empty = ({ hasAny }: { hasAny: boolean }) => {
    const { t } = useTranslation();
    return (
        <div className="bg-main-bg rounded-2xl border border-border px-8 py-15 flex items-center justify-center text-sm text-muted dark:text-primary tracking-[0.14px]">
            {hasAny ? t('beanDetail.empty.select') : t('beanDetail.empty.addFirst')}
        </div>
    );
};

export const BeanDetail = ({
    bean,
    hasAny,
    isLoading,
    affectedBlendNames,
    assetLine = null,
    onEdit,
    onRestock,
    onStartRoast,
    onDelete,
}: BeanDetailProps) => {
    const { t, i18n } = useTranslation();
    const [confirming, setConfirming] = useState(false);
    const { data: summary } = useBeanStockSummary(bean?.id ?? '');
    const { data: events = [] } = useBeanStockEvents(bean?.id ?? '');

    if (isLoading) return <Skeleton />;
    if (!bean) return <Empty hasAny={hasAny} />;

    const actionsLocked = isOptimisticId(bean.id);

    const currentGrams = summary?.currentGrams ?? 0;
    const effectiveGrams = summary?.effectiveGrams ?? 0;
    const currentStockKg = (currentGrams / 1000).toFixed(2);
    const stockStatus = getStatus(currentGrams, bean.low_stock_threshold_grams);
    const stockPct = stockLevelPct(currentGrams, bean.capacity_grams);

    const cur = currencySymbol(i18n.language);
    const unitCostLabel =
        assetLine?.unitCostPerKg != null ? `${cur}${formatAmount(assetLine.unitCostPerKg, i18n.language)}/kg` : '—';
    const assetValueLabel =
        assetLine?.assetValue != null
            ? `${cur}${formatAmount(assetLine.assetValue, i18n.language)}`
            : assetLine?.costSource === 'none'
              ? t('inventoryAsset.missingCost')
              : '—';

    return (
        <>
            <DeleteBeanModal
                open={confirming}
                beanName={bean.name}
                affectedBlendNames={affectedBlendNames}
                onClose={() => setConfirming(false)}
                onConfirm={() => {
                    onDelete(bean.id);
                    setConfirming(false);
                }}
            />
            <div className="bg-main-bg rounded-2xl border border-border px-8 py-7 h-fit relative">
                <div className="absolute top-6 right-6 flex gap-2 z-2">
                    <button
                        type="button"
                        disabled={actionsLocked}
                        onClick={() => onEdit(bean)}
                        className="w-9 h-9 rounded-[10px] border border-black/6 dark:border-border bg-white dark:bg-surface-elevated text-muted dark:text-primary flex items-center justify-center cursor-pointer transition-[color,background-color,box-shadow,opacity] duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Edit3 size={16} />
                    </button>
                    <button
                        type="button"
                        disabled={actionsLocked}
                        onClick={() => setConfirming(true)}
                        className="w-9 h-9 rounded-[10px] border border-black/6 dark:border-border bg-white dark:bg-surface-elevated flex items-center justify-center cursor-pointer transition-[color,background-color,box-shadow,opacity] duration-200 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>

                <div className="mb-6 pr-10">
                    <h2 className="font-(--font-display) text-[26px] leading-[1.2] text-primary tracking-[0.24px] mb-1">
                        {bean.name}
                    </h2>
                    <div className="flex gap-1.5">
                        {bean.process && (
                            <Badge
                                className="text-xs px-2.25"
                                color={processColor[bean.process]?.color ?? 'var(--color-secondary)'}
                                bg={processColor[bean.process]?.bg ?? 'var(--color-surface)'}
                            >
                                {bean.process}
                            </Badge>
                        )}
                        {bean.variety && (
                            <Badge tone="neutral" className="text-xs px-2.25">
                                {bean.variety}
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    {[
                        { label: t('beanDetail.origin'), value: bean.origin ?? '—' },
                        { label: t('beanDetail.region'), value: bean.region ?? '—' },
                        { label: t('beanDetail.farm'), value: bean.farm ?? '—' },
                        {
                            label: t('beanDetail.altitude'),
                            value: bean.altitude_masl ? `${bean.altitude_masl.toLocaleString()} masl` : '—',
                        },
                        { label: t('beanDetail.received'), value: bean.purchase_date ?? '—' },
                        {
                            label: t('beanDetail.currentStock'),
                            value: `${currentStockKg}kg`,
                            testId: 'bean-current-stock',
                        },
                        {
                            label: t('beanDetail.effective'),
                            value: `${(effectiveGrams / 1000).toFixed(2)}kg`,
                        },
                        {
                            label: t('inventoryAsset.avgCost'),
                            value: unitCostLabel,
                            hint:
                                assetLine?.costSource === 'master'
                                    ? t('inventoryAsset.masterFallbackHint')
                                    : assetLine?.costSource === 'none' && (assetLine.valuedGrams ?? 0) > 0
                                      ? t('inventoryAsset.missingCostHint')
                                      : undefined,
                        },
                        {
                            label: t('inventoryAsset.stockValue'),
                            value: assetValueLabel,
                        },
                    ].map(
                        ({
                            label,
                            value,
                            hint,
                            testId,
                        }: {
                            label: string;
                            value: string;
                            hint?: string;
                            testId?: string;
                        }) => (
                            <div key={label} data-testid={testId}>
                                <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-0.75">
                                    {label}
                                </div>
                                <div className="text-sm font-medium text-primary tracking-[0.14px]">{value}</div>
                                {hint && (
                                    <div className="text-[11px] text-muted tracking-[0.14px] mt-0.5 leading-snug">
                                        {hint}
                                    </div>
                                )}
                            </div>
                        ),
                    )}
                </div>

                {bean.tasting_notes && (
                    <div className="bg-surface-warm-solid rounded-lg px-4 py-3.5 mb-6">
                        <div className="text-[11px] font-medium text-muted tracking-[0.5px] uppercase mb-2">
                            {t('beanDetail.tastingNotes')}
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                            {bean.tasting_notes.split(', ').map((note) => (
                                <Badge key={note} tone="soft" className="text-xs px-2.5 py-1">
                                    {note}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}

                <div className="mb-6">
                    <div className="flex justify-between mb-1.5">
                        <span className="text-xs font-medium text-secondary tracking-[0.14px]">
                            {t('beanDetail.stockLevel')}
                        </span>
                        <span className="text-xs text-muted font-mono">
                            {(currentGrams / 1000).toFixed(2)}kg / {(bean.capacity_grams / 1000).toFixed(2)}kg
                        </span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-[color,background-color,box-shadow,opacity] duration-500 ${stockBarClass[stockStatus]}`}
                            style={{
                                width: `${stockPct}%`,
                            }}
                        />
                    </div>
                </div>

                <div className="flex gap-2.5">
                    <button
                        type="button"
                        disabled={actionsLocked}
                        onClick={() => onRestock(bean.id)}
                        className="flex-1 py-2.5 rounded-full border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-primary text-sm font-medium cursor-pointer tracking-[0.14px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t('beanDetail.restock')}
                    </button>
                    <button
                        type="button"
                        disabled={actionsLocked}
                        onClick={onStartRoast}
                        className="flex-1 py-2.5 rounded-full border border-border dark:border-0 bg-action text-on-action text-sm font-medium cursor-pointer tracking-[0.14px] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t('beanDetail.startRoast')}
                    </button>
                </div>

                <div className="mt-6 space-y-3">
                    <p className="text-xs font-medium text-gray-500 dark:text-primary">
                        {t('beanDetail.stockHistory.title')}
                    </p>
                    {events.length === 0 && (
                        <p className="text-xs text-gray-300 dark:text-primary">{t('beanDetail.stockHistory.empty')}</p>
                    )}
                    {events.length > 0 && (
                        <div
                            className={events.length > 3 ? 'max-h-[76px] overflow-y-auto space-y-3 pr-1' : 'space-y-3'}
                        >
                            {events.map((ev) => (
                                <div key={ev.id} className="flex items-start gap-3 text-xs">
                                    <span
                                        className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                                            ev.delta_grams > 0 ? 'bg-palette-green' : 'bg-palette-purple'
                                        }`}
                                    />
                                    <div className="flex-1">
                                        <span className="font-medium">
                                            {ev.delta_grams > 0 ? `+${ev.delta_grams}g` : `${ev.delta_grams}g`}
                                        </span>
                                        <span className="text-gray-400 dark:text-primary ml-1">
                                            {t(
                                                EVENT_TYPE_LABEL_KEY[ev.event_type] ??
                                                    'beanDetail.stockHistory.adjustment',
                                            )}
                                        </span>
                                        {ev.note && (
                                            <span className="text-gray-400 dark:text-primary ml-1">— {ev.note}</span>
                                        )}
                                    </div>
                                    <span className="text-gray-300 dark:text-primary whitespace-nowrap">
                                        {new Date(ev.created_at).toLocaleDateString(i18n.language)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
