import type { LucideIcon } from 'lucide-react';
import { Flame, Leaf, Package, Plus, Receipt, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    formatAmount,
    formatKrw,
    formatPctValue,
    inputCls,
    labelCls,
    parseNumericInput,
    parsePctInput,
} from '../lib/format';
import type { FixedOverheadItem } from '../lib/types';
import { PricingSection } from './PricingSection';

type CostBreakdownProps = {
    greenCostPerKg: number;
    yieldPct: number;
    onYieldChange: (value: number) => void;
    roastedCostPerKg: number;
    fixedOverheads: FixedOverheadItem[];
    overheadPerKg: number;
    onOverheadItemChange: (id: string, patch: Partial<FixedOverheadItem>) => void;
    onAddOverheadItem: () => void;
    onRemoveOverheadItem: (id: string) => void;
    totalCostPerKg: number;
    isBlend: boolean;
};

const MetricTile = ({
    label,
    value,
    unit,
    icon: Icon,
    emphasized = false,
    children,
}: {
    label: string;
    value?: string;
    unit?: string;
    icon: LucideIcon;
    emphasized?: boolean;
    children?: ReactNode;
}) => (
    <div
        className={`rounded-xl px-4 py-3.5 ${
            emphasized ? 'bg-surface-warm-solid' : 'bg-surface/50 dark:bg-surface-elevated/40'
        }`}
    >
        <div className="flex items-start justify-between mb-2.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted">{label}</span>
            <div className="w-8 h-8 rounded-lg bg-main-bg dark:bg-main-bg flex items-center justify-center shrink-0">
                <Icon size={15} strokeWidth={1.5} className="text-secondary" />
            </div>
        </div>
        {children ?? (
            <div className="font-mono text-[17px] font-semibold text-primary tabular-nums tracking-[-0.3px]">
                {value}
                {unit ? <span className="text-sm text-muted font-normal ml-1">{unit}</span> : null}
            </div>
        )}
    </div>
);

export const CostBreakdown = ({
    greenCostPerKg,
    yieldPct,
    onYieldChange,
    roastedCostPerKg,
    fixedOverheads,
    overheadPerKg,
    onOverheadItemChange,
    onAddOverheadItem,
    onRemoveOverheadItem,
    totalCostPerKg,
    isBlend,
}: CostBreakdownProps) => {
    const { t, i18n } = useTranslation();
    const lang = i18n.language;
    const perKg = t('pricing.selling.unit');

    return (
        <PricingSection step="02" title={t('pricing.cost.title')}>
            <div className="grid grid-cols-2 gap-3 mb-5">
                <MetricTile
                    label={isBlend ? t('pricing.cost.blendGreenCost') : t('pricing.cost.greenCost')}
                    value={formatKrw(greenCostPerKg, lang)}
                    unit={perKg}
                    icon={Leaf}
                />
                <MetricTile label={t('pricing.cost.yield')} icon={Flame}>
                    <div className="flex items-center gap-1.5">
                        <input
                            id="yield-pct"
                            type="text"
                            inputMode="decimal"
                            className={`${inputCls} max-w-[80px] text-right text-[17px] font-semibold font-mono py-2 tracking-[-0.3px]`}
                            value={formatPctValue(yieldPct, lang)}
                            onChange={(e) => onYieldChange(parsePctInput(e.target.value, lang))}
                        />
                        <span className="text-sm text-muted font-medium">%</span>
                    </div>
                </MetricTile>
                <MetricTile
                    label={t('pricing.cost.roastedCost')}
                    value={formatKrw(roastedCostPerKg, lang)}
                    unit={perKg}
                    icon={Package}
                    emphasized
                />
                <MetricTile
                    label={t('pricing.cost.overheadSum')}
                    value={formatKrw(overheadPerKg, lang)}
                    unit={perKg}
                    icon={Receipt}
                />
            </div>

            <div className="mb-5">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <span className={`${labelCls} mb-0`}>{t('pricing.cost.fixedOverhead')}</span>
                </div>
                <p className="text-[12px] text-muted tracking-[0.14px] mb-3 leading-snug">
                    {t('pricing.cost.fixedOverheadHint')}
                </p>

                <div className="grid grid-cols-[1fr_7rem_2rem] gap-2 px-2 mb-1 text-[10px] font-medium uppercase tracking-[0.5px] text-muted">
                    <span>{t('pricing.cost.itemName')}</span>
                    <span className="text-right">{t('pricing.cost.itemAmount')}</span>
                    <span />
                </div>

                <div className="flex flex-col gap-1.5">
                    {fixedOverheads.map((row, idx) => (
                        <div
                            key={row.id}
                            className={`grid grid-cols-[1fr_7rem_2rem] gap-2 items-center rounded-xl px-2 py-1.5 ${
                                idx % 2 === 0 ? 'bg-surface/50 dark:bg-surface-elevated/40' : ''
                            }`}
                        >
                            <input
                                type="text"
                                className={`${inputCls} text-[13px] py-2`}
                                placeholder={t('pricing.cost.itemNamePlaceholder')}
                                value={row.name}
                                onChange={(e) => onOverheadItemChange(row.id, { name: e.target.value })}
                            />
                            <input
                                type="text"
                                inputMode="numeric"
                                className={`${inputCls} text-right text-[13px] py-2 font-mono`}
                                placeholder={t('pricing.cost.itemAmountPlaceholder')}
                                value={row.amountPerKg > 0 ? formatAmount(row.amountPerKg, lang) : ''}
                                onChange={(e) =>
                                    onOverheadItemChange(row.id, {
                                        amountPerKg: parseNumericInput(e.target.value),
                                    })
                                }
                            />
                            <button
                                type="button"
                                className="w-8 h-8 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer hover:text-red-500"
                                onClick={() => onRemoveOverheadItem(row.id)}
                                aria-label={t('pricing.cost.removeItem')}
                            >
                                <X size={14} strokeWidth={2.5} />
                            </button>
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={onAddOverheadItem}
                    className="flex items-center gap-1.5 text-[13px] text-muted hover:text-secondary cursor-pointer bg-transparent border-none p-0 self-start mt-2"
                >
                    <Plus size={14} />
                    {t('pricing.cost.addItem')}
                </button>
            </div>

            <div className="pt-4 border-t border-black/6 dark:border-border">
                <div className="flex items-center justify-between bg-surface-warm-solid rounded-xl px-4 py-3.5">
                    <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                        {t('pricing.cost.totalCost')}
                    </span>
                    <div className="font-mono text-xl font-semibold text-primary tabular-nums tracking-[-0.3px]">
                        {formatKrw(totalCostPerKg, lang)}
                        <span className="text-sm text-muted font-normal ml-1">{perKg}</span>
                    </div>
                </div>
            </div>
        </PricingSection>
    );
};
