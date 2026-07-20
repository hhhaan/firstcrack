import { formatBeanCuppingMeta, useAddCuppingSamples } from '@entities/cupping';
import { useRoastSessions } from '@entities/roast';
import { formatDateShort } from '@shared/lib/format';
import {
    modalCancelBtnCls,
    modalFooterChrome,
    modalHeaderChrome,
    modalPrimaryBtnCls,
    tabCls,
} from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AddTab = 'roast' | 'custom';

type CuppingAddSamplesFormProps = {
    userId: string;
    eventId: string;
    onClose: () => void;
};

export const CuppingAddSamplesForm = ({ userId, eventId, onClose }: CuppingAddSamplesFormProps) => {
    const { t } = useTranslation();
    const { data: roastSessions = [] } = useRoastSessions(userId, 'completed');
    const addSamples = useAddCuppingSamples(userId, eventId);

    const [tab, setTab] = useState<AddTab>('roast');
    const [selectedRoastIds, setSelectedRoastIds] = useState<string[]>([]);
    const [freeLabel, setFreeLabel] = useState('');
    const [addError, setAddError] = useState<string | null>(null);

    const roastOptions = useMemo(
        () =>
            roastSessions.map((s) => {
                const beanName = s.beans?.name ?? t('cupping.unknownBean');
                const beanMeta = formatBeanCuppingMeta(s.beans);
                return {
                    id: s.id,
                    /** Sample label stored on cupping_samples — bean name, not roast date */
                    label: beanName,
                    beanName,
                    beanMeta,
                    roastedAt: s.roasted_at,
                    roastLevel: s.roast_level,
                    profileName: s.roast_profiles?.name ?? null,
                };
            }),
        [roastSessions, t],
    );

    const toggleRoast = (id: string) => {
        setSelectedRoastIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const handleAdd = async () => {
        setAddError(null);
        const items: { label: string; roastSessionId?: string | null }[] = [];

        if (tab === 'roast') {
            for (const id of selectedRoastIds) {
                const opt = roastOptions.find((o) => o.id === id);
                items.push({ label: opt?.label ?? t('cupping.unknownBean'), roastSessionId: id });
            }
            if (!items.length) {
                setAddError(t('cupping.addSamplesEmptyRoast'));
                return;
            }
        } else {
            if (!freeLabel.trim()) {
                setAddError(t('cupping.addSamplesEmptyCustom'));
                return;
            }
            items.push({ label: freeLabel.trim(), roastSessionId: null });
        }

        try {
            await addSamples.mutateAsync(items);
            onClose();
        } catch (e) {
            setAddError(e instanceof Error ? e.message : 'Failed');
        }
    };

    return (
        <ModalShell onClose={onClose} labelledBy="cupping-add-title" contentClassName={modalPanel.formLg}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="cupping-add-title"
                    title={t('cupping.addSamples')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-4"
                />
                <div className="px-8 pb-5">
                    <div className="flex rounded-2xl bg-surface p-1 shadow-(--shadow-inset)">
                        <button
                            type="button"
                            onClick={() => {
                                setTab('roast');
                                setAddError(null);
                            }}
                            className={tabCls(tab === 'roast')}
                        >
                            {t('cupping.addTabRoast')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setTab('custom');
                                setAddError(null);
                            }}
                            className={tabCls(tab === 'custom')}
                        >
                            {t('cupping.addTabCustom')}
                        </button>
                    </div>
                </div>
            </div>

            <ModalScrollBody contentClassName="p-8">
                {tab === 'roast' ? (
                    <>
                        <p className="mb-3 text-[12px] text-muted">{t('cupping.addSamplesHintRoast')}</p>
                        <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border-subtle p-2 dark:border-[#585d61]">
                            {roastOptions.length === 0 ? (
                                <div className="p-2 text-xs text-muted">{t('cupping.noRoasts')}</div>
                            ) : (
                                roastOptions.map((o) => (
                                    <label
                                        key={o.id}
                                        className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-[13px] hover:bg-surface"
                                    >
                                        <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={selectedRoastIds.includes(o.id)}
                                            onChange={() => toggleRoast(o.id)}
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-medium text-primary">{o.beanName}</span>
                                            {o.beanMeta ? (
                                                <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                                                    {o.beanMeta}
                                                </span>
                                            ) : null}
                                            <span className="mt-0.5 block font-mono text-[11px] text-secondary">
                                                {formatDateShort(o.roastedAt)}
                                                {o.roastLevel ? ` · ${o.roastLevel}` : ''}
                                                {o.profileName ? ` · ${o.profileName}` : ''}
                                            </span>
                                        </span>
                                    </label>
                                ))
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        <p className="mb-3 text-[12px] text-muted">{t('cupping.addSamplesHintCustom')}</p>
                        <label className="flex flex-col gap-1.5 text-[12px] text-muted">
                            {t('cupping.freeLabel')}
                            <input
                                value={freeLabel}
                                onChange={(e) => setFreeLabel(e.target.value)}
                                placeholder={t('cupping.freeLabelPlaceholder')}
                                className="w-full rounded-xl border border-black/8 bg-white/80 px-3.5 py-2.5 text-sm text-primary outline-none transition-all focus:border-black/20 dark:border-[#585d61] dark:bg-[#262b31] dark:focus:border-[#585d61] shadow-(--shadow-inset)"
                            />
                        </label>
                    </>
                )}
                {addError ? <div className="mt-3 text-xs text-red-600">{addError}</div> : null}
            </ModalScrollBody>

            <div className={modalFooterChrome}>
                <div className="flex gap-3">
                    <button type="button" onClick={onClose} className={modalCancelBtnCls}>
                        {t('cupping.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={addSamples.isPending}
                        onClick={() => void handleAdd()}
                        className={`${modalPrimaryBtnCls} flex-[2]`}
                    >
                        {addSamples.isPending ? t('cupping.adding') : t('cupping.add')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};
