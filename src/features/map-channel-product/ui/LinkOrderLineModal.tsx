import { type OrderLine, useSetOrderLineProduct } from '@entities/order';
import { useActiveWorkspace } from '@entities/organization';
import { useProducts, useUpsertProductChannelSku } from '@entities/product';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { FormSelect } from '@shared/ui/FormSelect';
import { labelCls, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
    line: OrderLine | null;
    /** The order's channel — the mapping is scoped to it. */
    platform: string;
    onClose: () => void;
};

/**
 * "This unmapped line is that product": stores the channel key the line already carries as a
 * mapping (so every future sync agrees) and binds the line itself so stock and roasting needs
 * pick it up without waiting for the next sync (#131).
 */
export const LinkOrderLineModal = ({ line, platform, onClose }: Props) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: products = [] } = useProducts(userId);
    const upsert = useUpsertProductChannelSku(userId);
    const setLineProduct = useSetOrderLineProduct(userId);

    const [productId, setProductId] = useState('');
    const [error, setError] = useState<string | null>(null);

    const open = line != null;
    useFormEscape(open, onClose);

    // biome-ignore lint/correctness/useExhaustiveDependencies: reset per line
    useEffect(() => {
        if (!open) return;
        setProductId('');
        setError(null);
    }, [open, line?.id]);

    if (!line) return null;

    const key = line.platform_variant_id ?? line.platform_product_id;
    const active = products.filter((p) => p.is_active);
    const pending = upsert.isPending || setLineProduct.isPending;

    const submit = async () => {
        if (!productId || !key) return;
        setError(null);
        try {
            await upsert.mutateAsync({ user_id: userId, product_id: productId, platform, external_key: key });
            await setLineProduct.mutateAsync({ lineId: line.id, productId });
            onClose();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg === 'order_line_not_relinkable' ? t('orders.mapping.notRelinkable') : msg);
        }
    };

    return (
        <ModalShell onClose={onClose} labelledBy="link-order-line-title" contentClassName={modalPanel.formSm}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="link-order-line-title"
                    title={t('orders.mapping.linkTitle')}
                    subtitle={<p className="mt-1 text-[13px] tracking-[0.14px] text-muted">{line.title}</p>}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-5">
                {key ? (
                    <p className="font-mono text-[12px] text-muted">
                        {t(`orders.channel.platform.${platform}`, { defaultValue: platform })} · {key}
                    </p>
                ) : (
                    <p className="text-[12px] text-muted">{t('orders.mapping.noKey')}</p>
                )}

                <div>
                    <label className={labelCls} htmlFor="link-product">
                        {t('orders.mapping.product')}
                    </label>
                    <FormSelect id="link-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                        <option value="">{t('orders.order.selectProduct')}</option>
                        {active.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                                {p.sku ? ` (${p.sku})` : ''}
                            </option>
                        ))}
                    </FormSelect>
                </div>

                <p className="text-[11px] text-muted">{t('orders.mapping.linkHelp')}</p>

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
                primaryDisabled={pending || !productId || !key}
                primaryLabel={pending ? t('orders.mapping.saving') : t('orders.mapping.linkSave')}
            />
        </ModalShell>
    );
};
