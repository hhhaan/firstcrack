import { useCreateOrder } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { useProducts } from '@entities/product';
import { cn } from '@shared/lib/cn';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { useToastStore } from '@shared/store/toast';
import { FormSelect } from '@shared/ui/FormSelect';
import { formErrorCls, inputCls, labelCls, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canSubmitOrderLines, type OrderLineDraft, parseOrderLineQuantity } from '../lib/schema';

type Props = { open: boolean; onClose: () => void };

type LineDraft = OrderLineDraft & { key: string };

type ManualOrderSubmission = { platformOrderId: string; orderedAt: string };

/** First submit of an open form. Retries reuse it; closing or reopening the modal clears it. */
const newManualOrderSubmission = (): ManualOrderSubmission => ({
    platformOrderId: `manual-${crypto.randomUUID()}`,
    orderedAt: new Date().toISOString(),
});

const emptyLine = (): LineDraft => ({ key: crypto.randomUUID(), productId: '', quantity: '1' });

export const AddOrderModal = ({ open, onClose }: Props) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: products = [] } = useProducts(userId);
    const createOrder = useCreateOrder(userId);

    const [buyer, setBuyer] = useState('');
    const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
    const submissionRef = useRef<ManualOrderSubmission | null>(null);
    const submitLock = useRef(false);

    useFormEscape(open, onClose);

    useEffect(() => {
        submissionRef.current = null;
        if (!open) return;
        setBuyer('');
        setLines([emptyLine()]);
    }, [open]);

    if (!open) return null;

    const valid = canSubmitOrderLines(lines);

    const onSubmit = async () => {
        if (!valid || submitLock.current) return;
        submitLock.current = true;
        submissionRef.current ??= newManualOrderSubmission();
        const submission = submissionRef.current;
        const parsedLines = lines.flatMap((l, i) => {
            const quantity = parseOrderLineQuantity(l.quantity);
            if (!l.productId || quantity === null) return [];
            const p = products.find((x) => x.id === l.productId);
            return [
                {
                    platform_line_id: `line-${i}`,
                    product_id: l.productId,
                    title: p?.name ?? '',
                    quantity,
                },
            ];
        });
        try {
            const result = await createOrder.mutateAsync({
                order: {
                    user_id: userId,
                    platform: 'manual',
                    platform_order_id: submission.platformOrderId,
                    status: 'paid',
                    ordered_at: submission.orderedAt,
                    buyer_name: buyer.trim() || null,
                },
                lines: parsedLines,
            });
            if (result.refetchFailed) {
                useToastStore.getState().show(t('orders.order.savedUnread'), 'info');
            }
            onClose();
        } catch {
            // MutationCache toasts the failure. Leave submissionRef so a retry reuses the key.
            return;
        } finally {
            submitLock.current = false;
        }
    };

    const setLine = (idx: number, patch: Partial<OrderLineDraft>) =>
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
                        {lines.map((l, idx) => {
                            const qtyInvalid = parseOrderLineQuantity(l.quantity) === null;
                            const qtyErrorId = `add-order-qty-error-${l.key}`;
                            return (
                                <div key={l.key} className="space-y-1">
                                    <div className="flex w-full items-center gap-2">
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
                                            step={1}
                                            inputMode="numeric"
                                            value={l.quantity}
                                            onChange={(e) => setLine(idx, { quantity: e.target.value })}
                                            className={cn(
                                                inputCls,
                                                'w-20 shrink-0 text-center tabular-nums',
                                                '[appearance:textfield]',
                                                '[&::-webkit-inner-spin-button]:appearance-none',
                                                '[&::-webkit-outer-spin-button]:appearance-none',
                                                qtyInvalid && 'border-red-500 dark:border-red-500',
                                            )}
                                            aria-invalid={qtyInvalid}
                                            aria-describedby={qtyInvalid ? qtyErrorId : undefined}
                                            aria-label={t('orders.order.quantity')}
                                        />
                                        {lines.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setLines((prev) => prev.filter((row) => row.key !== l.key))
                                                }
                                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-none bg-surface text-muted transition-colors hover:text-red-500 dark:bg-surface-elevated cursor-pointer"
                                                aria-label={t('common.delete')}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                    {qtyInvalid && (
                                        <p id={qtyErrorId} className={formErrorCls}>
                                            {t('orders.order.quantityMin')}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        onClick={() => setLines((prev) => [...prev, emptyLine()])}
                        className="mt-3 cursor-pointer text-sm font-medium text-primary underline"
                    >
                        {t('orders.order.addLine')}
                    </button>
                </div>
            </ModalScrollBody>

            <ModalFooter
                onCancel={onClose}
                cancelLabel={t('common.cancel')}
                onPrimary={onSubmit}
                primaryDisabled={!valid || createOrder.isPending}
                primaryLabel={t('common.add')}
            />
        </ModalShell>
    );
};
