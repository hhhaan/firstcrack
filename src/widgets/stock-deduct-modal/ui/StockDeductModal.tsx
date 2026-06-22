import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface StockDeductModalProps {
    open: boolean;
    beanName?: string;
    deductionKg: string;
    canDeduct: boolean;
    onClose: () => void;
    onConfirm: (deductStock: boolean) => void;
}

export const StockDeductModal = ({
    open,
    beanName,
    deductionKg,
    canDeduct,
    onClose,
    onConfirm,
}: StockDeductModalProps) => {
    const { t } = useTranslation();
    const [deductStock, setDeductStock] = useState(false);

    useEffect(() => {
        if (open) setDeductStock(false);
    }, [open]);

    if (!open) return null;

    const handleClose = () => {
        setDeductStock(false);
        onClose();
    };

    const handleConfirm = () => {
        onConfirm(deductStock && canDeduct);
        setDeductStock(false);
    };

    return (
        <ModalShell
            onClose={handleClose}
            labelledBy="stock-deduct-title"
            overlayClassName="z-[10000]"
            contentClassName="max-w-[420px] w-full bg-main-bg dark:bg-[#181d21] dark:[&_*]:!text-white rounded-[16px] p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px] border border-transparent dark:border-[#585d61]"
        >
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-palette-green/12 text-palette-green flex items-center justify-center shrink-0">
                    <Package size={18} strokeWidth={2.5} />
                </div>
                <div>
                    <h2
                        id="stock-deduct-title"
                        className="text-[18px] font-semibold text-primary tracking-[-0.3px] leading-tight"
                    >
                        {t('activeRoast.stockDeduct.title')}
                    </h2>
                    {beanName && <p className="text-[13px] text-secondary mt-0.5">{beanName}</p>}
                </div>
            </div>

            <p className="text-[13px] text-secondary leading-relaxed mb-4">
                {t('activeRoast.stockDeduct.description')}
            </p>

            {canDeduct && (
                <div className="rounded-lg bg-surface dark:bg-surface-elevated px-3.5 py-3 mb-4">
                    <div className="text-[12px] text-secondary">
                        {t('activeRoast.stockDeduct.deductionAmount', { kg: deductionKg })}
                    </div>
                </div>
            )}

            <label
                className={`flex items-start gap-2.5 mb-6 ${canDeduct ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            >
                <input
                    type="checkbox"
                    checked={deductStock}
                    disabled={!canDeduct}
                    onChange={(e) => setDeductStock(e.target.checked)}
                    className="mt-0.5 shrink-0"
                />
                <span className="text-[13px] text-primary leading-snug">
                    {canDeduct
                        ? t('activeRoast.stockDeduct.deductStock')
                        : t('activeRoast.stockDeduct.deductStockDisabled')}
                </span>
            </label>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 px-4 py-2.5 rounded-full border border-border bg-surface text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors"
                >
                    {t('activeRoast.stockDeduct.skip')}
                </button>
                <button
                    type="button"
                    onClick={handleConfirm}
                    className="flex-1 px-4 py-2.5 rounded-full border-none bg-primary text-white text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity"
                >
                    {t('activeRoast.stockDeduct.confirm')}
                </button>
            </div>
        </ModalShell>
    );
};
