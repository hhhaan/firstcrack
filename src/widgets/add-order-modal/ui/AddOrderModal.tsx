import { useCreateOrder } from '@entities/order';
import { useProducts } from '@entities/product';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { useAuthStore } from '@shared/store/auth';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = { open: boolean; onClose: () => void };

type LineDraft = { productId: string; quantity: string };

const inputCls =
    'w-full px-3.5 py-3 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all';
const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-muted mb-2 tracking-[0.02em] uppercase';

export const AddOrderModal = ({ open, onClose }: Props) => {
    const { t } = useTranslation();
    const userId = useAuthStore((s) => s.user?.id ?? '');
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
        <ModalShell
            onClose={onClose}
            labelledBy="add-order-modal-title"
            contentClassName="max-w-[520px] w-full max-h-[min(720px,calc(100vh-64px))] flex flex-col rounded-[16px] bg-[rgba(255,255,255,0.96)] dark:bg-[#181d21] dark:[&_*]:!text-white backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.25)] border border-white dark:border-[#585d61] overflow-hidden"
        >
            <div className="shrink-0 border-b border-black/4 bg-white/60 dark:border-[#585d61] dark:bg-[#1a1e23]">
                <ModalHeader
                    titleId="add-order-modal-title"
                    title={t('orders.order.newTitle')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-4">
                <div>
                    <label className={labelCls}>{t('orders.order.buyer')}</label>
                    <input value={buyer} onChange={(e) => setBuyer(e.target.value)} className={inputCls} />
                </div>

                <div>
                    <label className={labelCls}>{t('orders.order.lines')}</label>
                    <div className="space-y-2">
                        {lines.map((l, idx) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: draft rows have no stable id
                            <div key={idx} className="flex gap-2">
                                <select
                                    value={l.productId}
                                    onChange={(e) => setLine(idx, { productId: e.target.value })}
                                    className={`${inputCls} flex-1`}
                                >
                                    <option value="">{t('orders.order.selectProduct')}</option>
                                    {products.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="number"
                                    value={l.quantity}
                                    onChange={(e) => setLine(idx, { quantity: e.target.value })}
                                    className={`${inputCls} w-20`}
                                />
                                {lines.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                                        className="shrink-0 px-2 text-muted hover:text-red-500"
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

                <div className="!mt-8 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 rounded-2xl border-none bg-surface py-3.5 text-[15px] font-semibold text-secondary shadow-(--shadow-inset) dark:bg-surface-elevated dark:text-[#e5e5e5]"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={onSubmit}
                        disabled={!valid}
                        className="flex-1 rounded-2xl border border-transparent bg-primary py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:bg-black"
                    >
                        {t('common.add')}
                    </button>
                </div>
            </ModalScrollBody>
        </ModalShell>
    );
};
