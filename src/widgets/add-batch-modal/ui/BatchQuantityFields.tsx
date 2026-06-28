import { CounterInput } from '@shared/ui/CounterInput';
import { useTranslation } from 'react-i18next';

type Props = {
    targetRoasted: string;
    batchSize: string;
    yieldPct: string;
    targetNum: number;
    batchCount: number;
    greenNeeded: number;
    yieldNum: number;
    onTargetRoastedChange: (v: string | ((prev: string) => string)) => void;
    onBatchSizeChange: (v: string | ((prev: string) => string)) => void;
    onYieldPctChange: (v: string | ((prev: string) => string)) => void;
};

export const BatchQuantityFields = ({
    targetRoasted,
    batchSize,
    yieldPct,
    targetNum,
    batchCount,
    greenNeeded,
    yieldNum,
    onTargetRoastedChange,
    onBatchSizeChange,
    onYieldPctChange,
}: Props) => {
    const { t } = useTranslation();

    return (
        <>
            <div className="grid grid-cols-3 gap-4">
                <CounterInput
                    label={t('addBatchModal.targetRoasted')}
                    placeholder="0"
                    value={targetRoasted}
                    onChange={onTargetRoastedChange}
                    step={0.1}
                />
                <CounterInput
                    label={t('addBatchModal.batchSize')}
                    value={batchSize}
                    onChange={onBatchSizeChange}
                    step={1}
                />
                <CounterInput label={t('addBatchModal.yield')} value={yieldPct} onChange={onYieldPctChange} step={1} />
            </div>

            {targetNum > 0 && (
                <div className="rounded-2xl bg-surface/50 dark:bg-surface-elevated border border-border dark:border-[#585d61] p-4">
                    <div className="flex items-stretch gap-0 divide-x divide-border-subtle">
                        <div className="flex-1 flex flex-col items-center py-1 px-4">
                            <span className="text-[26px] font-bold text-primary tabular-nums leading-none">
                                {batchCount}
                            </span>
                            <span className="text-[11px] text-muted mt-1.5">{t('addBatchModal.batches')}</span>
                        </div>
                        <div className="flex-1 flex flex-col items-center py-1 px-4">
                            <span className="text-[26px] font-bold text-primary tabular-nums leading-none">
                                {greenNeeded}
                            </span>
                            <span className="text-[11px] text-muted mt-1.5">{t('addBatchModal.greenNeeded')}</span>
                        </div>
                        <div className="flex-1 flex flex-col items-center py-1 px-4">
                            <span className="text-[26px] font-bold text-primary tabular-nums leading-none">
                                {yieldNum}%
                            </span>
                            <span className="text-[11px] text-muted mt-1.5">{t('addBatchModal.yield')}</span>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
