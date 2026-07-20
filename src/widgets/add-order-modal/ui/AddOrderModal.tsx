import { useCreateOrder } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { useProducts } from '@entities/product';
import { cn } from '@shared/lib/cn';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { FormSelect } from '@shared/ui/FormSelect';
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
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = { open: boolean; onClose: () => void };

type LineDraft = { productId: string; quantity: string };

export const AddOrderModal = ({ open, onClose }: Props) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: products = [] } = useProducts(userId);
    const createOrder = useCreateOrder(userId);

    const [buyer, setBuyer] = useState('');
    const [lines, setLines] = useState<LineDraft[]>([{ productId: '', quantity: '1' }]);

    useFormEscape(open, onClose);

    useEffect(() => {
        if (!open) return;
        setBuyer('');
        setLines([{ productId: '', quantity: '1' }]);
    }, [open]);

    if (!open) return null;

    const validLines = lines.filter((l) => l.productId && Number(l.quantity) > 0);
    const valid = validLines.length > 0;

    const onSubmit = async () => {
        if (!valid) return;
        const now = new Date().toISOString();
        await createOrder.mutateAsync({
            order: {
                user_id: userId,
                platform: 'manual',
                platform_order_id: `manual-${Date.now()}`,
                status: 'paid',
                ordered_at: now,
                buyer_name: buyer.trim() || null,
            },
            lines: validLines.map((l, i) => {
                const p = products.find((x) => x.id === l.productId);
                return {
                    platform_line_id: `line-${i}`,
                    product_id: l.productId,
                    title: p?.name ?? '',
                    quantity: Number(l.quantity),
                };
            }),
        });
        onClose();
    };

    const setLine = (idx: number, patch: Partial<LineDraft>) =>
        setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

    return (
        <ModalShell onClose={onClose} labelledBy="add-order-modal-title" contentClassName={modalPanel.formSm}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="add-order-modal-title"
                    title={t('orders.order.newTitle')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-5">
                <div>
                    <label className={labelCls}>{t('orders.order.buyer')}</label>
                    <input value={buyer} onChange={(e) => setBuyer(e.target.value)} className={inputCls} />
                </div>

                <div>
                    <label className={labelCls}>{t('orders.order.lines')}</label>
                    <div className="space-y-2">
                        {lines.map((l, idx) => (
                            <div key={idx} className="flex w-full items-center gap-2">
                                <FormSelect
                                    value={l.productId}
                                    onChange={(e) => setLine(idx, { productId: e.target.value })}
                                    wrapperClassName="min-w-0 flex-1 basis-0"
                                >
                                    <option value="">{t('orders.order.selectProduct')}</option>
                                    {products.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                        </option>
                                    ))}
                                </FormSelect>
                                <input
                                    type="number"
                                    min={1}
                                    inputMode="numeric"
                                    value={l.quantity}
                                    onChange={(e) => setLine(idx, { quantity: e.target.value })}
                                    className={cn(
                                        inputCls,
                                        'w-20 shrink-0 text-center tabular-nums',
                                        '[appearance:textfield]',
                                        '[&::-webkit-inner-spin-button]:appearance-none',
                                        '[&::-webkit-outer-spin-button]:appearance-none',
                                    )}
                                    aria-label={t('orders.order.quantity', { defaultValue: 'Quantity' })}
                                />
                                {lines.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-none bg-surface text-muted transition-colors hover:text-red-500 dark:bg-surface-elevated cursor-pointer"
                                        aria-label={t('common.delete')}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => setLines((prev) => [...prev, { productId: '', quantity: '1' }])}
                        className="mt-3 cursor-pointer text-sm font-medium text-primary underline"
                    >
                        {t('orders.order.addLine')}
                    </button>
                </div>
            </ModalScrollBody>

            <div className={modalFooterChrome}>
                <div className="flex gap-3">
                    <button type="button" onClick={onClose} className={modalCancelBtnCls}>
                        {t('common.cancel')}
                    </button>
                    <button type="button" onClick={onSubmit} disabled={!valid} className={modalPrimaryBtnCls}>
                        {t('common.add')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};
