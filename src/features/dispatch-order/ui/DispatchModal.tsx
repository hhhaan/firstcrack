import { useDispatchOrder } from '@entities/order-dispatch';
import { useActiveWorkspace } from '@entities/organization';
import { CARRIER_OPTIONS, type ClientCarrierId } from '@shared/lib/carriers';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
    open: boolean;
    orderId: string | null;
    onClose: () => void;
};

export const DispatchModal = ({ open, orderId, onClose }: Props) => {
    const { t, i18n } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const dispatch = useDispatchOrder(userId);
    const [carrier, setCarrier] = useState<ClientCarrierId>('cj');
    const [tracking, setTracking] = useState('');
    const [error, setError] = useState<string | null>(null);

    useFormEscape(open, onClose);

    useEffect(() => {
        if (!open) return;
        setCarrier('cj');
        setTracking('');
        setError(null);
    }, [open, orderId]);

    if (!open || !orderId) return null;

    const ko = i18n.language?.startsWith('ko');

    const submit = async () => {
        setError(null);
        try {
            const res = await dispatch.mutateAsync({
                orderId,
                carrier,
                trackingNumber: tracking,
            });
            if (res.status === 'failed') {
                setError(res.error ?? t('orders.dispatch.failed'));
                return;
            }
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <ModalShell onClose={onClose} labelledBy="dispatch-order-title" contentClassName={modalPanel.formSm}>
            <div className="shrink-0 border-b border-black/4 bg-white/60 dark:border-[#585d61] dark:bg-[#1a1e23]">
                <ModalHeader
                    titleId="dispatch-order-title"
                    title={t('orders.dispatch.title')}
                    subtitle={t('orders.dispatch.subtitle')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-4">
                <div>
                    <label className={labelCls} htmlFor="dispatch-carrier">
                        {t('orders.dispatch.carrier')}
                    </label>
                    <select
                        id="dispatch-carrier"
                        className={inputCls}
                        value={carrier}
                        onChange={(e) => setCarrier(e.target.value as ClientCarrierId)}
                    >
                        {CARRIER_OPTIONS.map((c) => (
                            <option key={c.id} value={c.id}>
                                {ko ? c.labelKo : c.labelEn}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className={labelCls} htmlFor="dispatch-tracking">
                        {t('orders.dispatch.tracking')}
                    </label>
                    <input
                        id="dispatch-tracking"
                        className={inputCls}
                        value={tracking}
                        onChange={(e) => setTracking(e.target.value)}
                        placeholder={t('orders.dispatch.trackingPh')}
                        autoComplete="off"
                    />
                </div>

                {error ? (
                    <p className="rounded-lg bg-[rgba(192,57,43,0.07)] px-3 py-2 text-[12px] leading-relaxed text-[#c0392b] tracking-[0.14px]">
                        {error}
                    </p>
                ) : null}

                <div className="!mt-8 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 rounded-full border-none bg-surface py-3 text-[14px] font-medium tracking-[0.14px] text-secondary shadow-(--shadow-inset) transition-colors hover:bg-surface-elevated cursor-pointer dark:bg-surface-elevated dark:text-[#e5e5e5]"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={dispatch.isPending || !tracking.trim()}
                        onClick={() => void submit()}
                        className="flex-1 rounded-full border border-transparent bg-primary py-3 text-[14px] font-medium tracking-[0.14px] text-white transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:border-white dark:bg-[#0d0d0d] cursor-pointer"
                    >
                        {dispatch.isPending ? t('orders.dispatch.submitting') : t('orders.dispatch.submit')}
                    </button>
                </div>
            </ModalScrollBody>
        </ModalShell>
    );
};
