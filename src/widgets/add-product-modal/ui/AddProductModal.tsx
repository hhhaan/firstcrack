import { useBeans } from '@entities/bean';
import { useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import type { Product } from '@entities/product';
import { useCreateProduct, useUpdateProduct } from '@entities/product';
import { useRoastProfiles } from '@entities/roast-profile';
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
    onClose: () => void;
    editing?: Product | null;
};

/** Source: single bean, a blend, or neither (non-coffee merch). */
type Source = { kind: 'bean' | 'blend'; id: string } | { kind: 'none' };

export const AddProductModal = ({ open, onClose, editing }: Props) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: beans = [] } = useBeans(userId);
    const { data: blends = [] } = useBlends(userId);
    const { data: profiles = [] } = useRoastProfiles(userId);
    const createProduct = useCreateProduct(userId);
    const updateProduct = useUpdateProduct(userId);

    const [name, setName] = useState('');
    const [sku, setSku] = useState('');
    const [source, setSource] = useState<Source>({ kind: 'none' });
    const [profileId, setProfileId] = useState('');
    const [netWeight, setNetWeight] = useState('200');
    const [yieldPct, setYieldPct] = useState('85');
    const [submitting, setSubmitting] = useState(false);

    useFormEscape(open, onClose);

    useEffect(() => {
        if (!open) return;
        if (editing) {
            setName(editing.name);
            setSku(editing.sku ?? '');
            setSource(
                editing.bean_id
                    ? { kind: 'bean', id: editing.bean_id }
                    : editing.blend_id
                      ? { kind: 'blend', id: editing.blend_id }
                      : { kind: 'none' },
            );
            setProfileId(editing.roast_profile_id ?? '');
            setNetWeight(String(editing.net_weight_grams));
            setYieldPct(String(Math.round(Number(editing.yield_pct) * 100)));
        } else {
            setName('');
            setSku('');
            setSource({ kind: 'none' });
            setProfileId('');
            setNetWeight('200');
            setYieldPct('85');
        }
        setSubmitting(false);
    }, [open, editing]);

    if (!open) return null;

    const netWeightNum = Number(netWeight);
    const yieldNum = Number(yieldPct);
    const valid = name.trim() && netWeightNum > 0 && yieldNum > 0 && yieldNum <= 100;
    const sourceValue = source.kind === 'none' ? '' : `${source.kind}:${source.id}`;

    const onSubmit = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            const payload = {
                name: name.trim(),
                sku: sku.trim() || null,
                bean_id: source.kind === 'bean' ? source.id : null,
                blend_id: source.kind === 'blend' ? source.id : null,
                roast_profile_id: profileId || null,
                net_weight_grams: netWeightNum,
                yield_pct: yieldNum / 100,
            };
            if (editing) {
                await updateProduct.mutateAsync({ id: editing.id, patch: payload });
            } else {
                await createProduct.mutateAsync({ ...payload, user_id: userId });
            }
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalShell onClose={onClose} labelledBy="add-product-modal-title" contentClassName={modalPanel.formSm}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="add-product-modal-title"
                    title={editing ? t('orders.product.editTitle') : t('orders.product.newTitle')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-5">
                <div>
                    <label className={labelCls} htmlFor="product-name">
                        {t('orders.product.name')}
                    </label>
                    <input
                        id="product-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={inputCls}
                        autoComplete="off"
                    />
                </div>

                <div>
                    <label className={labelCls} htmlFor="product-sku">
                        SKU
                    </label>
                    <input
                        id="product-sku"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        className={inputCls}
                        autoComplete="off"
                    />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls} htmlFor="product-net-weight">
                            {t('orders.product.netWeight')}
                        </label>
                        <div className="relative">
                            <input
                                id="product-net-weight"
                                type="number"
                                min={1}
                                value={netWeight}
                                onChange={(e) => setNetWeight(e.target.value)}
                                className={`${inputCls} pr-10`}
                            />
                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-medium text-muted">
                                g
                            </span>
                        </div>
                    </div>
                    <div>
                        <label className={labelCls} htmlFor="product-yield">
                            {t('orders.product.yield')}
                        </label>
                        <div className="relative">
                            <input
                                id="product-yield"
                                type="number"
                                min={1}
                                max={100}
                                value={yieldPct}
                                onChange={(e) => setYieldPct(e.target.value)}
                                className={`${inputCls} pr-10`}
                            />
                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-medium text-muted">
                                %
                            </span>
                        </div>
                    </div>
                </div>

                <div>
                    <label className={labelCls} htmlFor="product-source">
                        {t('orders.product.source')}
                    </label>
                    <FormSelect
                        id="product-source"
                        value={sourceValue}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return setSource({ kind: 'none' });
                            const [kind, id] = v.split(':');
                            setSource({ kind: kind as 'bean' | 'blend', id });
                        }}
                    >
                        <option value="">{t('orders.product.sourceNone')}</option>
                        <optgroup label={t('orders.product.beanGroup')}>
                            {beans.map((b) => (
                                <option key={b.id} value={`bean:${b.id}`}>
                                    {b.name}
                                </option>
                            ))}
                        </optgroup>
                        <optgroup label={t('orders.product.blendGroup')}>
                            {blends.map((b) => (
                                <option key={b.id} value={`blend:${b.id}`}>
                                    {b.name}
                                </option>
                            ))}
                        </optgroup>
                    </FormSelect>
                </div>

                <div>
                    <label className={labelCls} htmlFor="product-profile">
                        {t('orders.product.profile')}
                    </label>
                    <FormSelect id="product-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                        <option value="">{t('orders.product.profileNone')}</option>
                        {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </FormSelect>
                </div>
            </ModalScrollBody>

            <ModalFooter
                onCancel={onClose}
                cancelLabel={t('common.cancel')}
                onPrimary={() => void onSubmit()}
                primaryDisabled={!valid || submitting}
                primaryLabel={editing ? t('common.save') : t('common.add')}
            />
        </ModalShell>
    );
};
