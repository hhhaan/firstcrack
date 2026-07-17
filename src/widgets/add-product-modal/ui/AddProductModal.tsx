import { useBeans } from '@entities/bean';
import { useBlends } from '@entities/blend';
import type { Product } from '@entities/product';
import { useCreateProduct, useUpdateProduct } from '@entities/product';
import { useRoastProfiles } from '@entities/roast-profile';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { useAuthStore } from '@shared/store/auth';
import { inputCls, labelCls } from '@shared/ui/form-styles';
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
    const userId = useAuthStore((s) => s.user?.id ?? '');
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
    }, [open, editing]);

    if (!open) return null;

    const netWeightNum = Number(netWeight);
    const yieldNum = Number(yieldPct);
    const valid = name.trim() && netWeightNum > 0 && yieldNum > 0 && yieldNum <= 100;

    const sourceValue = source.kind === 'none' ? '' : `${source.kind}:${source.id}`;

    const onSubmit = async () => {
        if (!valid) return;
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
    };

    return (
        <ModalShell onClose={onClose} labelledBy="add-product-modal-title" contentClassName={modalPanel.formSm}>
            <div className="shrink-0 border-b border-black/4 bg-white/60 dark:border-[#585d61] dark:bg-[#1a1e23]">
                <ModalHeader
                    titleId="add-product-modal-title"
                    title={editing ? t('orders.product.editTitle') : t('orders.product.newTitle')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-4">
                <div>
                    <label className={labelCls}>{t('orders.product.name')}</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </div>

                <div className="flex gap-3">
                    <div className="flex-1">
                        <label className={labelCls}>SKU</label>
                        <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputCls} />
                    </div>
                    <div className="w-28">
                        <label className={labelCls}>{t('orders.product.netWeight')}</label>
                        <input
                            type="number"
                            value={netWeight}
                            onChange={(e) => setNetWeight(e.target.value)}
                            className={inputCls}
                        />
                    </div>
                    <div className="w-20">
                        <label className={labelCls}>{t('orders.product.yield')}</label>
                        <input
                            type="number"
                            value={yieldPct}
                            onChange={(e) => setYieldPct(e.target.value)}
                            className={inputCls}
                        />
                    </div>
                </div>

                <div>
                    <label className={labelCls}>{t('orders.product.source')}</label>
                    <select
                        value={sourceValue}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return setSource({ kind: 'none' });
                            const [kind, id] = v.split(':');
                            setSource({ kind: kind as 'bean' | 'blend', id });
                        }}
                        className={inputCls}
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
                    </select>
                </div>

                <div>
                    <label className={labelCls}>{t('orders.product.profile')}</label>
                    <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className={inputCls}>
                        <option value="">{t('orders.product.profileNone')}</option>
                        {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </div>

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
                        onClick={onSubmit}
                        disabled={!valid}
                        className="flex-1 rounded-full border border-transparent bg-primary py-3 text-[14px] font-medium tracking-[0.14px] text-white transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:border-white dark:bg-[#0d0d0d] cursor-pointer"
                    >
                        {editing ? t('common.save') : t('common.add')}
                    </button>
                </div>
            </ModalScrollBody>
        </ModalShell>
    );
};
