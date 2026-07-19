import { type BlendWithComponents, blendApi } from '@entities/blend';
import { useActiveWorkspace } from '@entities/organization';
import { useRoastedStock } from '@entities/roasted-stock-event';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { PillButton } from '@shared/ui/PillButton';
import { useQuery } from '@tanstack/react-query';
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
    const { data: blends = [] } = useQuery({
        queryKey: ['blends', userId],
        queryFn: () => blendApi.list(userId),
        enabled: !!userId && open,
    });
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

    // Prefill inputs from recipe when blend or target changes
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

    if (!open) return null;

    const submit = async () => {
        if (!blendId || !selected) return;
        const payload = selected.blend_components.map((c) => ({
            beanId: c.bean_id,
            grams: inputs[c.bean_id] ?? 0,
        }));
        await blendRoasted({ blendId, inputs: payload, outputGrams, note: note.trim() || undefined });
        onClose();
    };

    return (
        <ModalShell onClose={onClose} labelledBy="blend-roasted-title" contentClassName={modalPanel.formMd}>
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <ModalHeader titleId="blend-roasted-title" title={t('inventory.blending.title')} onClose={onClose} />
            </div>
            <ModalScrollBody>
                <div className="flex flex-col gap-4 p-4">
                    <label className="flex flex-col gap-1">
                        <span className={labelCls}>{t('inventory.blending.selectBlend')}</span>
                        <select
                            className={inputCls}
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
                        </select>
                    </label>

                    {selected && (
                        <>
                            <label className="flex flex-col gap-1">
                                <span className={labelCls}>{t('inventory.blending.targetOutput')}</span>
                                <input
                                    type="number"
                                    min={1}
                                    className={inputCls}
                                    value={targetGrams}
                                    onChange={(e) => setTargetGrams(Math.max(0, Number(e.target.value) || 0))}
                                />
                            </label>

                            <div>
                                <div className={`${labelCls} mb-2`}>{t('inventory.blending.componentInputs')}</div>
                                <div className="grid gap-2">
                                    {selected.blend_components.map((c) => {
                                        const available = stock[`bean:${c.bean_id}`]?.grams ?? 0;
                                        const grams = inputs[c.bean_id] ?? 0;
                                        const over = grams > available;
                                        return (
                                            <div
                                                key={c.bean_id}
                                                className="rounded-lg border border-border-subtle px-3 py-2"
                                            >
                                                <div className="mb-1 flex items-center justify-between gap-2">
                                                    <span className="text-[13px] font-medium text-primary">
                                                        {c.beans?.name ?? c.bean_id}
                                                        <span className="ml-1 text-[11px] text-muted">
                                                            ({Number(c.ratio_pct)}%)
                                                        </span>
                                                    </span>
                                                    <span className="text-[11px] text-muted">
                                                        {t('inventory.blending.available', {
                                                            kg: (available / 1000).toFixed(2),
                                                        })}
                                                    </span>
                                                </div>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className={inputCls}
                                                    value={grams}
                                                    onChange={(e) =>
                                                        setInputs((prev) => ({
                                                            ...prev,
                                                            [c.bean_id]: Math.max(0, Number(e.target.value) || 0),
                                                        }))
                                                    }
                                                />
                                                {over && (
                                                    <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                                        {t('inventory.blending.insufficientHint')}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="mt-2 text-[11px] text-muted">Σ {inputSum}g</p>
                            </div>

                            <label className="flex flex-col gap-1">
                                <span className={labelCls}>{t('inventory.blending.actualOutput')}</span>
                                <input
                                    type="number"
                                    min={1}
                                    className={inputCls}
                                    value={outputGrams}
                                    onChange={(e) => {
                                        setOutputTouched(true);
                                        setOutputGrams(Math.max(0, Number(e.target.value) || 0));
                                    }}
                                />
                            </label>

                            <label className="flex flex-col gap-1">
                                <span className={labelCls}>{t('inventory.blending.note')}</span>
                                <input
                                    type="text"
                                    className={inputCls}
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                />
                            </label>

                            <div className="flex justify-end">
                                <PillButton
                                    onClick={() => void submit()}
                                    disabled={isPending || inputSum <= 0 || outputGrams <= 0}
                                >
                                    {t('inventory.blending.submit')}
                                </PillButton>
                            </div>
                        </>
                    )}
                </div>
            </ModalScrollBody>
        </ModalShell>
    );
};
