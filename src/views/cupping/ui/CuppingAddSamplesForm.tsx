import {
    type CuppingSampleWithMeta,
    formatBeanCuppingMeta,
    useAddCuppingSamples,
    useUpdateCuppingSample,
} from '@entities/cupping';
import { useRoastSessions } from '@entities/roast';
import { formatDateShort } from '@shared/lib/format';
import { modalHeaderChrome, tabCls } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
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
    sample?: CuppingSampleWithMeta;
};

export const CuppingAddSamplesForm = ({ userId, eventId, onClose, sample }: CuppingAddSamplesFormProps) => {
    const { t } = useTranslation();
    const { data: roastSessions = [] } = useRoastSessions(userId, 'completed');
    const addSamples = useAddCuppingSamples(userId, eventId);
    const updateSample = useUpdateCuppingSample(eventId);
    const isEdit = !!sample;

    const [tab, setTab] = useState<AddTab>(sample && !sample.roast_session_id ? 'custom' : 'roast');
    const [selectedRoastIds, setSelectedRoastIds] = useState<string[]>(
        sample?.roast_session_id ? [sample.roast_session_id] : [],
    );
    const [freeLabel, setFreeLabel] = useState(sample?.label ?? '');
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
        if (isEdit) {
            setSelectedRoastIds([id]);
            return;
        }
        setSelectedRoastIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const handleSubmit = async () => {
        setAddError(null);
        try {
            if (sample) {
                if (tab === 'roast') {
                    const id = selectedRoastIds[0];
                    if (!id) {
                        setAddError(t('cupping.addSamplesEmptyRoast'));
                        return;
                    }
                    const opt = roastOptions.find((o) => o.id === id);
                    await updateSample.mutateAsync({
                        sampleId: sample.id,
                        label: opt?.label ?? t('cupping.unknownBean'),
                        roastSessionId: id,
                    });
                } else {
                    if (!freeLabel.trim()) {
                        setAddError(t('cupping.addSamplesEmptyCustom'));
                        return;
                    }
                    await updateSample.mutateAsync({
                        sampleId: sample.id,
                        label: freeLabel.trim(),
                        roastSessionId: null,
                    });
                }
            } else {
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
                await addSamples.mutateAsync(items);
            }
            onClose();
        } catch (e) {
            setAddError(e instanceof Error ? e.message : 'Failed');
        }
    };

    const pending = isEdit ? updateSample.isPending : addSamples.isPending;
    const submitLabel = pending
        ? t(isEdit ? 'cupping.saving' : 'cupping.adding')
        : t(isEdit ? 'common.save' : 'cupping.add');

    return (
        <ModalShell
            onClose={onClose}
            labelledBy={isEdit ? 'cupping-edit-title' : 'cupping-add-title'}
            contentClassName={modalPanel.formLg}
        >
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId={isEdit ? 'cupping-edit-title' : 'cupping-add-title'}
                    title={t(isEdit ? 'cupping.editSample' : 'cupping.addSamples')}
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
                        <p className="mb-3 text-[12px] text-muted">
                            {t(isEdit ? 'cupping.editSamplesHintRoast' : 'cupping.addSamplesHintRoast')}
                        </p>
                        <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border-subtle p-2 dark:border-border">
                            {roastOptions.length === 0 ? (
                                <div className="p-2 text-xs text-muted">{t('cupping.noRoasts')}</div>
                            ) : (
                                roastOptions.map((o) => (
                                    <label
                                        key={o.id}
                                        className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-[13px] hover:bg-surface"
                                    >
                                        <input
                                            type={isEdit ? 'radio' : 'checkbox'}
                                            name={isEdit ? 'cupping-edit-roast' : undefined}
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
                                className="w-full rounded-xl border border-black/8 bg-white/80 px-3.5 py-2.5 text-sm text-primary outline-none transition-[color,background-color,box-shadow,opacity] focus:border-black/20 dark:border-border dark:bg-surface-elevated dark:focus:border-[#585d61] shadow-(--shadow-inset)"
                            />
                        </label>
                    </>
                )}
                {addError ? <div className="mt-3 text-xs text-red-600">{addError}</div> : null}
            </ModalScrollBody>

            <ModalFooter
                onCancel={onClose}
                cancelLabel={t('cupping.cancel')}
                onPrimary={() => void handleSubmit()}
                primaryDisabled={pending}
                primaryClassName="flex-[2]"
                primaryLabel={submitLabel}
            />
        </ModalShell>
    );
};
