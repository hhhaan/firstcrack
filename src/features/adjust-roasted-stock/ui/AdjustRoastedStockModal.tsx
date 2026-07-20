import { useFormEscape } from '@shared/lib/useFormEscape';
import { AdjustStockFields } from '@shared/ui/AdjustStockFields';
import { modalCancelBtnCls, modalFooterChrome, modalHeaderChrome, modalPrimaryBtnCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdjustRoastedStock } from '../model/useAdjustRoastedStock';

type Props = {
    open: boolean;
    onClose: () => void;
    name: string;
    beanId: string | null;
    blendId: string | null;
    /** Current stock in grams — for exceed warning + display */
    currentGrams?: number;
    kindLabel?: string;
};

export const AdjustRoastedStockModal = ({ open, onClose, name, beanId, blendId, currentGrams, kindLabel }: Props) => {
    const { t } = useTranslation();
    const { mutateAsync, isPending } = useAdjustRoastedStock();
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

    const kg = parseFloat(amount);
    const grams = Number.isFinite(kg) && kg > 0 ? Math.round(kg * 1000) : 0;
    const currentKg = currentGrams != null ? currentGrams / 1000 : undefined;

    const submit = async () => {
        if (grams <= 0) return;
        await mutateAsync({ beanId, blendId, type, sign, grams, note });
        onClose();
    };

    return (
        <ModalShell onClose={onClose} labelledBy="adjust-roasted-title" contentClassName={modalPanel.formMd}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="adjust-roasted-title"
                    title={t('inventory.adjust.title')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>
            <ModalScrollBody contentClassName="p-8">
                <AdjustStockFields
                    name={name}
                    kindLabel={kindLabel}
                    currentStockLabel={currentKg != null ? `${currentKg.toFixed(2)} kg` : undefined}
                    unitLabel="kg"
                    amountMode="decimal"
                    type={type}
                    sign={sign}
                    amount={amount}
                    note={note}
                    amountValue={Number.isFinite(kg) ? kg : 0}
                    currentStock={currentKg}
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
                    disabled={isPending || grams <= 0}
                    onClick={() => void submit()}
                >
                    {t('inventory.adjust.submit')}
                </button>
            </div>
        </ModalShell>
    );
};
