import { formatBeanCuppingMeta, useAddCuppingSamples } from '@entities/cupping';
import { useRoastSessions } from '@entities/roast';
import { formatDateShort } from '@shared/lib/format';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CuppingAddSamplesFormProps = {
    userId: string;
    eventId: string;
    onClose: () => void;
};

export const CuppingAddSamplesForm = ({ userId, eventId, onClose }: CuppingAddSamplesFormProps) => {
    const { t } = useTranslation();
    const { data: roastSessions = [] } = useRoastSessions(userId, 'completed');
    const addSamples = useAddCuppingSamples(userId, eventId);

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
        for (const id of selectedRoastIds) {
            const opt = roastOptions.find((o) => o.id === id);
            items.push({ label: opt?.label ?? t('cupping.unknownBean'), roastSessionId: id });
        }
        if (freeLabel.trim()) {
            items.push({ label: freeLabel.trim(), roastSessionId: null });
        }
        if (!items.length) {
            setAddError(t('cupping.addSamplesEmpty'));
            return;
        }
        try {
            await addSamples.mutateAsync(items);
            onClose();
        } catch (e) {
            setAddError(e instanceof Error ? e.message : 'Failed');
        }
    };

    return (
        <ModalShell onClose={onClose} labelledBy="cupping-add-title">
            <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-main-bg p-6 shadow-lg dark:border dark:border-[#585d61]">
                <h2 id="cupping-add-title" className="mb-4 text-base font-semibold text-primary">
                    {t('cupping.addSamples')}
                </h2>
                <p className="mb-3 text-[12px] text-muted">{t('cupping.addSamplesHint')}</p>
                <div className="mb-4 max-h-56 space-y-1 overflow-y-auto rounded-md border border-border-subtle p-2 dark:border-[#585d61]">
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
                <label className="mb-4 flex flex-col gap-1 text-[12px] text-muted">
                    {t('cupping.freeLabel')}
                    <input
                        value={freeLabel}
                        onChange={(e) => setFreeLabel(e.target.value)}
                        placeholder={t('cupping.freeLabelPlaceholder')}
                        className="rounded-md border border-border-subtle bg-main-bg px-3 py-2 text-[13px] text-primary dark:border-[#585d61]"
                    />
                </label>
                {addError ? <div className="mb-3 text-xs text-red-600">{addError}</div> : null}
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full border border-border-subtle px-4 py-2 text-xs dark:border-[#585d61]"
                    >
                        {t('cupping.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={addSamples.isPending}
                        onClick={() => void handleAdd()}
                        className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                        {addSamples.isPending ? t('cupping.adding') : t('cupping.add')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};
