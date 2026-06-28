import type { Bean } from '@shared/types/database.types';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Props = {
    selectedBean: Bean | undefined;
    effectiveStockKg: number;
    greenNeeded: number;
    stockSufficient: boolean;
    stockPct: number;
};

export const BatchStockPanel = ({ selectedBean, effectiveStockKg, greenNeeded, stockSufficient, stockPct }: Props) => {
    const { t } = useTranslation();

    if (!selectedBean) return null;

    return (
        <div
            className={`rounded-2xl border p-4 transition-colors ${
                !stockSufficient
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-border dark:border-[#585d61] bg-surface/40 dark:bg-[#1a1e23]'
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-[13px] font-semibold text-primary">{selectedBean.name}</div>
                    <div className="text-[12px] text-secondary mt-0.5">
                        {t('addBatchModal.currentStock')}{' '}
                        <span className="font-medium text-primary">{effectiveStockKg.toFixed(1)} kg</span>
                        {greenNeeded > 0 && (
                            <span className="text-muted ml-2">
                                {t('addBatchModal.needed')} {greenNeeded} kg
                            </span>
                        )}
                    </div>
                </div>
                {!stockSufficient && (
                    <div className="flex items-center gap-1.5 text-amber-600 text-[12px] font-semibold shrink-0">
                        <AlertTriangle size={13} strokeWidth={2} />
                        {t('addBatchModal.insufficientStock')}
                    </div>
                )}
            </div>
            {greenNeeded > 0 && (
                <div className="mt-3 h-1.5 rounded-full bg-black/6 dark:bg-white/8 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-300 ${
                            !stockSufficient ? 'bg-amber-400' : 'bg-surface-warm-solid'
                        }`}
                        style={{ width: `${stockPct}%` }}
                    />
                </div>
            )}
        </div>
    );
};
