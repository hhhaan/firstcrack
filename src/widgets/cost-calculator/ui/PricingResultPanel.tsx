import { useTranslation } from 'react-i18next';
import { formatKrw, inputCls, labelCls, parseNumericInput } from '../lib/format';
import { CostFlowStrip } from './CostFlowStrip';
import { MarginSlider } from './MarginSlider';
import { PricingSection } from './PricingSection';

type PricingResultPanelProps = {
    marginPct: number;
    onMarginChange: (value: number) => void;
    sellingPricePerKg: number;
    onSellingPriceChange: (value: number) => void;
    profitPerKg: number;
    totalCostPerKg: number;
    greenCostPerKg: number;
    yieldPct: number;
    roastedCostPerKg: number;
    overheadPerKg: number;
};

export const PricingResultPanel = ({
    marginPct,
    onMarginChange,
    sellingPricePerKg,
    onSellingPriceChange,
    profitPerKg,
    totalCostPerKg,
    greenCostPerKg,
    yieldPct,
    roastedCostPerKg,
    overheadPerKg,
}: PricingResultPanelProps) => {
    const { t } = useTranslation();

    return (
        <PricingSection title={t('pricing.selling.title')}>
            <div className="flex-1 flex flex-col">
                <div className="bg-surface-warm-solid rounded-xl px-6 py-6 text-center mb-6">
                    <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted mb-2 block">
                        {t('pricing.selling.price')}
                    </span>
                    <div className="font-mono font-semibold text-[36px] text-primary tracking-[-0.5px] tabular-nums leading-[1.1]">
                        {formatKrw(sellingPricePerKg)}
                    </div>
                    <span className="text-[13px] text-muted tracking-[0.14px]">/ kg</span>
                </div>

                <div className="mb-2">
                    <MarginSlider
                        id="margin-slider"
                        label={t('pricing.selling.margin')}
                        value={marginPct}
                        onChange={onMarginChange}
                    />
                </div>
                <p className="text-[12px] text-muted tracking-[0.14px] mb-5 leading-snug">
                    {t('pricing.selling.hint')}
                </p>

                <div className="mb-5">
                    <label className={labelCls} htmlFor="selling-price-edit">
                        {t('pricing.selling.priceEdit')}
                    </label>
                    <input
                        id="selling-price-edit"
                        type="text"
                        inputMode="numeric"
                        className={inputCls}
                        placeholder={t('pricing.selling.pricePlaceholder')}
                        value={sellingPricePerKg > 0 ? sellingPricePerKg.toLocaleString() : ''}
                        onChange={(e) => onSellingPriceChange(parseNumericInput(e.target.value))}
                    />
                </div>

                <div className="h-px bg-black/6 dark:bg-border mb-5" />

                <div className="flex flex-col gap-3 mb-5">
                    <div className="flex items-center justify-between rounded-xl bg-surface/60 dark:bg-surface-elevated/60 px-4 py-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('pricing.selling.costBasis')}
                        </span>
                        <span className="font-mono text-[15px] font-medium text-secondary tabular-nums">
                            {formatKrw(totalCostPerKg)}
                            <span className="text-muted font-normal text-[13px] ml-1">/ kg</span>
                        </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-surface-warm-solid px-4 py-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                            {t('pricing.selling.profit')}
                        </span>
                        <span className="font-mono text-[17px] font-semibold text-palette-green tabular-nums tracking-[-0.3px]">
                            {formatKrw(profitPerKg)}
                            <span className="text-muted font-normal text-[13px] ml-1">/ kg</span>
                        </span>
                    </div>
                </div>

                <CostFlowStrip
                    greenCostPerKg={greenCostPerKg}
                    yieldPct={yieldPct}
                    roastedCostPerKg={roastedCostPerKg}
                    overheadPerKg={overheadPerKg}
                    sellingPricePerKg={sellingPricePerKg}
                />
            </div>
        </PricingSection>
    );
};
