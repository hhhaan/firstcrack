import { useFormEscape } from '@shared/lib/useFormEscape';
import {
    inputCls,
    labelCls,
    modalCancelBtnCls,
    modalFooterChrome,
    modalHeaderChrome,
    modalPrimaryBtnCls,
} from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdjustProductStock } from '../model/useAdjustProductStock';

type Props = {
    open: boolean;
    onClose: () => void;
    productId: string;
    name: string;
};

export const AdjustProductStockModal = ({ open, onClose, productId, name }: Props) => {
    const { t } = useTranslation();
    const { mutateAsync, isPending } = useAdjustProductStock();
    const [type, setType] = useState<'adjustment' | 'write_off'>('adjustment');
    const [sign, setSign] = useState<'+' | '-'>('+');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');

    useFormEscape(open, onClose);
    if (!open) return null;

    const units = Math.round(parseFloat(amount)) || 0;

    const submit = async () => {
        if (units <= 0) return;
        await mutateAsync({ productId, type, sign, units, note });
        onClose();
    };

    return (
        <ModalShell onClose={onClose} labelledBy="adjust-product-title" contentClassName={modalPanel.formSm}>
            <div className={modalHeaderChrome}>
                <ModalHeader titleId="adjust-product-title" title={t('inventory.adjust.title')} onClose={onClose} />
            </div>
            <ModalScrollBody>
                <p className="mb-4 text-[13px] font-medium text-primary">{name}</p>
                <div className="mb-4 flex rounded-xl bg-surface p-1">
                    <button
                        type="button"
                        className={`flex-1 rounded-lg py-2 text-[12px] font-medium ${type === 'adjustment' ? 'bg-main-bg text-primary shadow-sm' : 'text-muted'}`}
                        onClick={() => setType('adjustment')}
                    >
                        {t('inventory.adjust.adjustment')}
                    </button>
                    <button
                        type="button"
                        className={`flex-1 rounded-lg py-2 text-[12px] font-medium ${type === 'write_off' ? 'bg-main-bg text-primary shadow-sm' : 'text-muted'}`}
                        onClick={() => {
                            setType('write_off');
                            setSign('+');
                        }}
                    >
                        {t('inventory.adjust.writeOff')}
                    </button>
                </div>
                <label className={labelCls}>{t('inventory.adjust.amount')}</label>
                <div className="mb-4 flex items-center gap-2">
                    {type === 'adjustment' && (
                        <div className="flex overflow-hidden rounded-xl border border-border-subtle">
                            {(['+', '-'] as const).map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setSign(s)}
                                    className={`w-10 py-2 text-lg font-semibold ${sign === s ? 'bg-primary text-white' : 'bg-main-bg text-muted'}`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                    <input
                        className={`${inputCls} text-xl font-semibold`}
                        inputMode="numeric"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="0"
                    />
                    <span className="text-sm text-muted">{t('inventory.adjust.units')}</span>
                </div>
                <label className={labelCls}>{t('inventory.adjust.reason')}</label>
                <input
                    className={inputCls}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                        type === 'write_off'
                            ? t('inventory.adjust.writeOffPlaceholder')
                            : t('inventory.adjust.adjustPlaceholder')
                    }
                />
            </ModalScrollBody>
            <div className={modalFooterChrome}>
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
