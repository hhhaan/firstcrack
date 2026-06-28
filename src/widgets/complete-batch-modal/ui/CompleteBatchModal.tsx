import { batchGreenNeededGramsFromBatch } from '@shared/lib/batch-stock';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CompleteBatchModalProps {
    open: boolean;
    batch: PlanBatchWithProgress | null;
    onClose: () => void;
    onConfirm: (deductStock: boolean) => void;
}

export const CompleteBatchModal = ({ open, batch, onClose, onConfirm }: CompleteBatchModalProps) => {
    const { t } = useTranslation();
    const [deductStock, setDeductStock] = useState(false);

    if (!open || !batch) return null;

    const remainingSessions = Math.max(0, batch.batch_count - batch.completed_sessions);
    const deductionKg = (batchGreenNeededGramsFromBatch(batch) / 1000).toFixed(1);
    const canDeductStock = remainingSessions > 0 && Boolean(batch.bean_id || batch.blend_id);

    const handleClose = () => {
        setDeductStock(false);
        onClose();
    };

    const handleConfirm = () => {
        onConfirm(deductStock && canDeductStock);
        setDeductStock(false);
    };

    return (
        <ModalShell
            onClose={handleClose}
            labelledBy="complete-batch-title"
            overlayClassName="z-[10000]"
            contentClassName="max-w-[420px] w-full bg-main-bg dark:bg-[#181d21] dark:[&_*]:!text-white rounded-[16px] p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px] border border-transparent dark:border-[#585d61]"
        >
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-palette-green/12 text-palette-green flex items-center justify-center shrink-0">
                    <Check size={18} strokeWidth={2.5} />
                </div>
                <div>
                    <h2
                        id="complete-batch-title"
                        className="text-[18px] font-semibold text-primary tracking-[-0.3px] leading-tight"
                    >
                        {t('schedule.completeBatch.title')}
                    </h2>
                    <p className="text-[13px] text-secondary mt-0.5">{batch.bean_name}</p>
                </div>
            </div>

            <p className="text-[13px] text-secondary leading-relaxed mb-4">
                {t('schedule.completeBatch.description', { name: batch.bean_name })}
            </p>

            <div className="rounded-lg bg-surface dark:bg-surface-elevated px-3.5 py-3 mb-4 space-y-1.5">
                <div className="text-[12px] text-secondary">
                    {t('schedule.completeBatch.remainingSessions', { count: remainingSessions })}
                </div>
                {canDeductStock && (
                    <div className="text-[12px] text-secondary">
                        {t('schedule.completeBatch.deductionAmount', { kg: deductionKg })}
                    </div>
                )}
            </div>

            <label
                className={`flex items-start gap-2.5 mb-6 ${canDeductStock ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            >
                <input
                    type="checkbox"
                    checked={deductStock}
                    disabled={!canDeductStock}
                    onChange={(e) => setDeductStock(e.target.checked)}
                    className="mt-0.5 shrink-0"
                />
                <span className="text-[13px] text-primary leading-snug">
                    {canDeductStock
                        ? t('schedule.completeBatch.deductStock')
                        : t('schedule.completeBatch.deductStockDisabled')}
                </span>
            </label>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 px-4 py-2.5 rounded-full border border-border bg-surface text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors"
                >
                    {t('schedule.completeBatch.cancel')}
                </button>
                <button
                    type="button"
                    onClick={handleConfirm}
                    className="flex-1 px-4 py-2.5 rounded-full border-none bg-black text-white text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity"
                >
                    {t('schedule.completeBatch.confirm')}
                </button>
            </div>
        </ModalShell>
    );
};
