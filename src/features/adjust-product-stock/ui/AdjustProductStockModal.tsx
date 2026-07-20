import { useFormEscape } from '@shared/lib/useFormEscape';
import { AdjustStockFields } from '@shared/ui/AdjustStockFields';
import { modalCancelBtnCls, modalFooterChrome, modalHeaderChrome, modalPrimaryBtnCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdjustProductStock } from '../model/useAdjustProductStock';

type Props = {
    open: boolean;
    onClose: () => void;
    productId: string;
    name: string;
    /** Current stock in bags */
    currentUnits?: number;
};

export const AdjustProductStockModal = ({ open, onClose, productId, name, currentUnits }: Props) => {
    const { t } = useTranslation();
    const { mutateAsync, isPending } = useAdjustProductStock();
    const [type, setType] = useState<'adjustment' | 'write_off'>('adjustment');
    const [sign, setSign] = useState<'+' | '-'>('+');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');

    useFormEscape(open, onClose);

    useEffect(() => {
        if (!open) {
            setType('adjustment');
            setSign('+');
            setAmount('');
            setNote('');
        }
    }, [open]);

    if (!open) return null;

    const units = Math.round(parseFloat(amount)) || 0;

    const submit = async () => {
        if (units <= 0) return;
        await mutateAsync({ productId, type, sign, units, note });
        onClose();
    };

    return (
        <ModalShell onClose={onClose} labelledBy="adjust-product-title" contentClassName={modalPanel.formMd}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="adjust-product-title"
                    title={t('inventory.adjust.title')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>
            <ModalScrollBody contentClassName="p-8">
                <AdjustStockFields
                    name={name}
                    kindLabel={t('inventory.tabs.products')}
                    currentStockLabel={
                        currentUnits != null ? `${currentUnits} ${t('inventory.adjust.units')}` : undefined
                    }
                    unitLabel={t('inventory.adjust.units')}
                    amountMode="integer"
                    type={type}
                    sign={sign}
                    amount={amount}
                    note={note}
                    amountValue={units}
                    currentStock={currentUnits}
                    onTypeChange={setType}
                    onSignChange={setSign}
                    onAmountChange={setAmount}
                    onNoteChange={setNote}
                />
            </ModalScrollBody>
            <div className={`${modalFooterChrome} flex gap-3`}>
                <button type="button" className={modalCancelBtnCls} onClick={onClose}>
                    {t('common.cancel')}
                </button>
                <button
                    type="button"
                    className={modalPrimaryBtnCls}
                    disabled={isPending || units <= 0}
                    onClick={() => void submit()}
                >
                    {t('inventory.adjust.submit')}
                </button>
            </div>
        </ModalShell>
    );
};
