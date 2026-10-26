import { type BlendWithComponents, useBlends } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastedStock } from '@entities/roasted-stock-event';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, labelCls, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlendRoasted } from '../model/useBlendRoasted';

type Props = {
    open: boolean;
    onClose: () => void;
};

export const BlendRoastedModal = ({ open, onClose }: Props) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
    const { data: blends = [] } = useBlends(userId);
    const { data: stock = {} } = useRoastedStock(userId, open);
    const { blendRoasted, isPending } = useBlendRoasted();

    const [blendId, setBlendId] = useState('');
    const [targetGrams, setTargetGrams] = useState(5000);
    const [inputs, setInputs] = useState<Record<string, number>>({});
    const [outputGrams, setOutputGrams] = useState(5000);
    const [note, setNote] = useState('');
    const [outputTouched, setOutputTouched] = useState(false);

    useFormEscape(open, onClose);

    const selected: BlendWithComponents | undefined = blends.find((b) => b.id === blendId);

    useEffect(() => {
        if (!selected) {
            setInputs({});
            return;
        }
        const next: Record<string, number> = {};
        for (const c of selected.blend_components) {
            next[c.bean_id] = Math.round((targetGrams * Number(c.ratio_pct)) / 100);
        }
        setInputs(next);
        if (!outputTouched) setOutputGrams(targetGrams);
    }, [selected, targetGrams, outputTouched]);

    useEffect(() => {
        if (!open) {
            setBlendId('');
            setTargetGrams(5000);
            setInputs({});
            setOutputGrams(5000);
            setNote('');
            setOutputTouched(false);
        }
    }, [open]);

    const inputSum = useMemo(() => Object.values(inputs).reduce((a, b) => a + (b || 0), 0), [inputs]);
    const outputTooHigh = outputGrams > inputSum;
    const canSubmit = !!blendId && !!selected && inputSum > 0 && outputGrams > 0 && !outputTooHigh && !isPending;

    if (!open) return null;

    const submit = async () => {
        if (!blendId || !selected || !canSubmit) return;
        const payload = selected.blend_components.map((c) => ({
            beanId: c.bean_id,
            grams: inputs[c.bean_id] ?? 0,
        }));
        await blendRoasted({ blendId, inputs: payload, outputGrams, note: note.trim() || undefined });
        onClose();
    };

    return (
        <ModalShell onClose={onClose} labelledBy="blend-roasted-title" contentClassName={modalPanel.formMd}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="blend-roasted-title"
                    title={t('inventory.blending.title')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <ModalScrollBody contentClassName="p-8 space-y-5">
                <div>
                    <label className={labelCls} htmlFor="blend-roasted-select">
                        {t('inventory.blending.selectBlend')}
                    </label>
                    <FormSelect
                        id="blend-roasted-select"
                        value={blendId}
                        onChange={(e) => {
                            setBlendId(e.target.value);
                            setOutputTouched(false);
                        }}
                    >
                        <option value="">{t('inventory.blending.selectBlend')}</option>
                        {blends.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name}
                            </option>
                        ))}
                    </FormSelect>
                </div>

                {selected && (
                    <>
                        <div>
                            <label className={labelCls} htmlFor="blend-target-output">
                                {t('inventory.blending.targetOutput')}
                            </label>
                            <div className="relative">
                                <input
                                    id="blend-target-output"
                                    type="number"
                                    min={1}
                                    className={`${inputCls} pr-10`}
                                    value={targetGrams}
                                    onChange={(e) => setTargetGrams(Math.max(0, Number(e.target.value) || 0))}
                                />
                                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-medium text-muted">
                                    g
                                </span>
                            </div>
                        </div>

                        <div>
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <label className={`${labelCls} mb-0`}>{t('inventory.blending.componentInputs')}</label>
                                <span className="font-mono text-[11px] text-muted">Σ {inputSum}g</span>
                            </div>
                            <div className="space-y-2">
                                {selected.blend_components.map((c) => {
                                    const available = stock[`bean:${c.bean_id}`]?.grams ?? 0;
                                    const grams = inputs[c.bean_id] ?? 0;
                                    const over = grams > available;
                                    return (
                                        <div
                                            key={c.bean_id}
                                            className="rounded-xl border border-black/6 bg-surface/40 px-3.5 py-3 dark:border-[#585d61] dark:bg-surface-elevated/40"
                                        >
                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                <span className="text-[13px] font-medium tracking-[0.14px] text-primary">
                                                    {c.beans?.name ?? c.bean_id}
                                                    <span className="ml-1.5 text-[11px] font-medium text-muted">
                                                        {Number(c.ratio_pct)}%
                                                    </span>
                                                </span>
                                                <span className="text-[11px] tracking-[0.14px] text-muted">
                                                    {t('inventory.blending.available', {
                                                        kg: (available / 1000).toFixed(2),
                                                    })}
                                                </span>
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className={`${inputCls} pr-10`}
                                                    value={grams}
                                                    onChange={(e) =>
                                                        setInputs((prev) => ({
                                                            ...prev,
                                                            [c.bean_id]: Math.max(0, Number(e.target.value) || 0),
                                                        }))
                                                    }
                                                />
                                                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-medium text-muted">
                                                    g
                                                </span>
                                            </div>
                                            {over && (
                                                <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                                    {t('inventory.blending.insufficientHint')}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <label className={labelCls} htmlFor="blend-actual-output">
                                {t('inventory.blending.actualOutput')}
                            </label>
                            <div className="relative">
                                <input
                                    id="blend-actual-output"
                                    type="number"
                                    min={1}
                                    className={`${inputCls} pr-10`}
                                    value={outputGrams}
                                    onChange={(e) => {
                                        setOutputTouched(true);
                                        setOutputGrams(Math.max(0, Number(e.target.value) || 0));
                                    }}
                                />
                                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-medium text-muted">
                                    g
                                </span>
                            </div>
                            {outputTooHigh && (
                                <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                    {t('inventory.blending.outputExceedsInput')}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className={labelCls} htmlFor="blend-note">
                                {t('inventory.blending.note')}
                            </label>
                            <input
                                id="blend-note"
                                type="text"
                                className={inputCls}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                            />
                        </div>
                    </>
                )}
            </ModalScrollBody>

            <ModalFooter
                onCancel={onClose}
                cancelLabel={t('common.cancel')}
                onPrimary={() => void submit()}
                primaryDisabled={!canSubmit}
                primaryLabel={t('inventory.blending.submit')}
            />
        </ModalShell>
    );
};
