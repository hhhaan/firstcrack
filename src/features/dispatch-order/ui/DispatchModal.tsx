import { useDispatchOrder } from '@entities/order-dispatch';
import { useActiveWorkspace } from '@entities/organization';
import { CARRIER_OPTIONS, type ClientCarrierId } from '@shared/lib/carriers';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, labelCls, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
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

    // biome-ignore lint/correctness/useExhaustiveDependencies: reset when orderId changes while open
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
            // Platform ship ok but auto-fulfill failed — keep modal open so user can act
            if (res.fulfillError) {
                setError(t('orders.dispatch.fulfillFailed', { detail: res.fulfillError }));
                return;
            }
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <ModalShell onClose={onClose} labelledBy="dispatch-order-title" contentClassName={modalPanel.formSm}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="dispatch-order-title"
                    title={t('orders.dispatch.title')}
                    subtitle={
                        <p className="mt-1 text-[13px] tracking-[0.14px] text-muted">{t('orders.dispatch.subtitle')}</p>
                    }
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-5">
                <div>
                    <label className={labelCls} htmlFor="dispatch-carrier">
                        {t('orders.dispatch.carrier')}
                    </label>
                    <FormSelect
                        id="dispatch-carrier"
                        value={carrier}
                        onChange={(e) => setCarrier(e.target.value as ClientCarrierId)}
                    >
                        {CARRIER_OPTIONS.map((c) => (
                            <option key={c.id} value={c.id}>
                                {ko ? c.labelKo : c.labelEn}
                            </option>
                        ))}
                    </FormSelect>
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
                    <p className="rounded-lg bg-[rgba(192,57,43,0.07)] px-3 py-2 text-[12px] leading-relaxed tracking-[0.14px] text-[#c0392b]">
                        {error}
                    </p>
                ) : null}
            </ModalScrollBody>

            <ModalFooter
                onCancel={onClose}
                cancelLabel={t('common.cancel')}
                onPrimary={() => void submit()}
                primaryDisabled={dispatch.isPending || !tracking.trim()}
                primaryLabel={dispatch.isPending ? t('orders.dispatch.submitting') : t('orders.dispatch.submit')}
            />
        </ModalShell>
    );
};
