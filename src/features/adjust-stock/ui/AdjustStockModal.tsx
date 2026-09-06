import { useFormEscape } from '@shared/lib/useFormEscape';
import { modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdjustStockSign, AdjustStockType } from '../lib/signedDelta';
import { useAdjustStock } from '../model/useAdjustStock';
import { AdjustStockFields } from './AdjustStockFields';

type BaseProps = {
    open: boolean;
    onClose: () => void;
    name: string;
};

type ProductProps = BaseProps & {
    kind: 'product';
    productId: string;
    /** Current stock in bags */
    currentUnits?: number;
};

type RoastedProps = BaseProps & {
    kind: 'roasted';
    beanId: string | null;
    blendId: string | null;
    /** Current stock in grams */
    currentGrams?: number;
    kindLabel?: string;
};

export type AdjustStockModalProps = ProductProps | RoastedProps;

export const AdjustStockModal = (props: AdjustStockModalProps) => {
    const { open, onClose, name, kind } = props;
    const { t } = useTranslation();
    const { mutateAsync, isPending } = useAdjustStock();
    const [type, setType] = useState<AdjustStockType>('adjustment');
    const [sign, setSign] = useState<AdjustStockSign>('+');
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

    const isProduct = kind === 'product';
    const parsed = parseFloat(amount);
    const units = isProduct ? Math.round(parsed) || 0 : 0;
    const grams = !isProduct && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1000) : 0;
    const amountValue = isProduct ? units : Number.isFinite(parsed) ? parsed : 0;
    const canSubmit = isProduct ? units > 0 : grams > 0;

    const currentStock = isProduct
        ? props.currentUnits
        : props.currentGrams != null
          ? props.currentGrams / 1000
          : undefined;

    const currentStockLabel = isProduct
        ? props.currentUnits != null
            ? `${props.currentUnits} ${t('inventory.adjust.units')}`
            : undefined
        : currentStock != null
          ? `${currentStock.toFixed(2)} kg`
          : undefined;

    const submit = async () => {
        if (!canSubmit) return;
        if (isProduct) {
            await mutateAsync({
                kind: 'product',
                productId: props.productId,
                type,
                sign,
                units,
                note,
            });
        } else {
            await mutateAsync({
                kind: 'roasted',
                beanId: props.beanId,
                blendId: props.blendId,
                type,
                sign,
                grams,
                note,
            });
        }
        onClose();
    };

    return (
        <ModalShell onClose={onClose} labelledBy="adjust-stock-title" contentClassName={modalPanel.formMd}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="adjust-stock-title"
                    title={t('inventory.adjust.title')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>
            <ModalScrollBody contentClassName="p-8">
                <AdjustStockFields
                    name={name}
                    kindLabel={isProduct ? t('inventory.tabs.products') : props.kindLabel}
                    currentStockLabel={currentStockLabel}
                    unitLabel={isProduct ? t('inventory.adjust.units') : 'kg'}
                    amountMode={isProduct ? 'integer' : 'decimal'}
                    type={type}
                    sign={sign}
                    amount={amount}
                    note={note}
                    amountValue={amountValue}
                    currentStock={currentStock}
                    onTypeChange={setType}
                    onSignChange={setSign}
                    onAmountChange={setAmount}
                    onNoteChange={setNote}
                />
            </ModalScrollBody>
            <ModalFooter
                onCancel={onClose}
                cancelLabel={t('common.cancel')}
                onPrimary={() => void submit()}
                primaryDisabled={isPending || !canSubmit}
                primaryLabel={t('inventory.adjust.submit')}
            />
        </ModalShell>
    );
};
