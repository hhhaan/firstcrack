import { useTranslation } from 'react-i18next';
import { formatKrw, formatPctValue } from '../lib/format';

type FlowStep = {
    key: string;
    labelKey: string;
    value: number;
    display?: string;
};

type CostFlowStripProps = {
    greenCostPerKg: number;
    yieldPct: number;
    roastedCostPerKg: number;
    overheadPerKg: number;
    sellingPricePerKg: number;
};

export const CostFlowStrip = ({
    greenCostPerKg,
    yieldPct,
    roastedCostPerKg,
    overheadPerKg,
    sellingPricePerKg,
}: CostFlowStripProps) => {
    const { t, i18n } = useTranslation();

    const steps: FlowStep[] = [
        { key: 'green', labelKey: 'pricing.flow.green', value: greenCostPerKg },
        {
            key: 'yield',
            labelKey: 'pricing.flow.yield',
            value: yieldPct,
            display: yieldPct > 0 ? `${formatPctValue(yieldPct, i18n.language)}%` : '—',
        },
        { key: 'roasted', labelKey: 'pricing.flow.roasted', value: roastedCostPerKg },
        { key: 'overhead', labelKey: 'pricing.flow.overhead', value: overheadPerKg },
        { key: 'sell', labelKey: 'pricing.flow.sell', value: sellingPricePerKg },
    ];

    return (
        <div className="pt-4 border-t border-black/6 dark:border-border">
            <div className="grid grid-cols-3 gap-x-3 gap-y-3">
                {steps.map((step, i) => {
                    const muted = step.value <= 0;
                    const isLast = i === steps.length - 1;
                    return (
                        <div key={step.key} className={muted ? 'opacity-40' : undefined}>
                            <div className="flex items-center gap-1.5 mb-1">
                                <div
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        isLast ? 'bg-palette-green' : 'bg-primary/40'
                                    }`}
                                />
                                <span className="text-[11px] font-medium tracking-[0.14px] text-muted">
                                    {t(step.labelKey)}
                                </span>
                            </div>
                            <div className="font-mono text-[13px] font-medium text-primary tabular-nums pl-3">
                                {step.display ?? formatKrw(step.value, i18n.language)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
