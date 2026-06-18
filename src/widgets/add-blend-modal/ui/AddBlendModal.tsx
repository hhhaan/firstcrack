import { useBeans } from '@entities/bean';
import type { BlendWithComponents } from '@entities/blend';
import { useCreateBlend, useUpdateBlend } from '@entities/blend';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { useAuthStore } from '@shared/store/auth';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { ChevronDown, X } from 'lucide-react';
import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { type BlendForm, blendFormSchema } from '../lib/schema';

type Props = {
    open: boolean;
    onClose: () => void;
    editing?: BlendWithComponents | null;
};

const inputCls =
    'w-full px-3.5 py-3 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all';

const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-muted mb-2 tracking-[0.02em] uppercase';

export const AddBlendModal = ({ open, onClose, editing }: Props) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: beans = [] } = useBeans(userId);
    const createBlend = useCreateBlend(userId);
    const updateBlend = useUpdateBlend(userId);

    const {
        register,
        handleSubmit,
        control,
        reset,
        watch,
        formState: { errors, isValid },
    } = useForm<BlendForm>({
        resolver: zodResolver(blendFormSchema),
        mode: 'onChange',
        defaultValues: {
            name: '',
            description: '',
            components: [{ bean_id: '', ratio_pct: 100 }],
        },
    });

    const { fields, append, remove } = useFieldArray({ control, name: 'components' });

    useFormEscape(open, onClose);

    const components = watch('components');
    const totalRatio = components?.reduce((s, c) => s + (c.ratio_pct ?? 0), 0) ?? 0;

    // Reset form when opening or switching between create/edit
    useEffect(() => {
        if (!open) return;
        if (editing) {
            reset({
                name: editing.name ?? '',
                description: editing.description ?? '',
                components: editing.blend_components.map((c) => ({
                    bean_id: c.bean_id,
                    ratio_pct: Number(c.ratio_pct),
                })),
            });
        } else {
            reset({
                name: '',
                description: '',
                components: [{ bean_id: '', ratio_pct: 100 }],
            });
        }
    }, [open, editing, reset]);

    if (!open) return null;

    const onSubmit = async (data: BlendForm) => {
        if (editing) {
            await updateBlend.mutateAsync({
                id: editing.id,
                patch: { name: data.name.trim(), description: data.description.trim() || undefined },
                components: data.components,
            });
        } else {
            await createBlend.mutateAsync({
                blend: { name: data.name.trim(), description: data.description.trim() || undefined, user_id: userId },
                components: data.components,
            });
        }
        onClose();
    };

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="add-blend-modal-title"
            contentClassName="max-w-[560px] w-full max-h-[min(720px,calc(100vh-64px))] flex flex-col rounded-[16px] bg-[rgba(255,255,255,0.96)] dark:bg-[#181d21] dark:[&_*]:!text-white backdrop-[blur(20px)_saturate(180%)] shadow-[0_32px_80px_rgba(22,18,12,0.25)] border border-white dark:border-[#585d61] overflow-hidden"
        >
            {/* Header */}
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <div className="flex items-center justify-between px-8 pt-6 pb-5">
                    <h2
                        id="add-blend-modal-title"
                        className="font-(--font-display) text-2xl text-primary tracking-[-0.02em] m-0"
                    >
                        {editing ? '블렌드 수정' : '블렌드 추가'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200"
                    >
                        <X size={18} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Scrollable Body */}
            <form onSubmit={handleSubmit(onSubmit)} className="p-8 overflow-y-auto flex-1 space-y-4">
                {/* Name */}
                <div>
                    <label className={labelCls}>블렌드 이름</label>
                    <input {...register('name')} className={inputCls} placeholder="블렌드 이름" />
                    {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name.message}</p>}
                </div>

                {/* Description */}
                <div>
                    <label className={labelCls}>설명 (선택)</label>
                    <input {...register('description')} className={inputCls} placeholder="설명 (선택)" />
                </div>

                {/* Components */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <label className={labelCls + ' mb-0'}>구성 생두</label>
                        <span
                            className={`text-xs font-semibold ${totalRatio === 100 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}
                        >
                            합계 {totalRatio}%
                        </span>
                    </div>
                    {errors.components?.root && (
                        <p className="text-[11px] text-red-500 mb-2">{errors.components.root.message}</p>
                    )}

                    <div className="space-y-2">
                        {fields.map((field, idx) => (
                            <div key={field.id} className="flex gap-2 items-center">
                                <div className="relative flex-1">
                                    <select
                                        {...register(`components.${idx}.bean_id`)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary outline-none transition-all appearance-none cursor-pointer"
                                        style={{ paddingRight: '2rem' }}
                                    >
                                        <option value="">생두 선택</option>
                                        {beans.map((b) => (
                                            <option key={b.id} value={b.id}>
                                                {b.name}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown
                                        size={16}
                                        strokeWidth={2}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                                    />
                                </div>
                                <input
                                    type="number"
                                    {...register(`components.${idx}.ratio_pct`, { valueAsNumber: true })}
                                    className="w-20 px-3 py-2.5 rounded-xl border border-black/8 dark:border-[#585d61] bg-white/80 dark:bg-[#262b31] shadow-(--shadow-inset) text-sm text-primary text-right outline-none transition-all"
                                    placeholder="%"
                                    min={1}
                                    max={100}
                                />
                                <span className="text-sm text-muted">%</span>
                                {fields.length > 1 && (
                                    <button
                                        type="button"
                                        className="w-8 h-8 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all duration-200 hover:text-red-500"
                                        onClick={() => remove(idx)}
                                    >
                                        <X size={14} strokeWidth={2.5} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <button
                        type="button"
                        className="mt-3 text-sm text-primary font-medium underline cursor-pointer"
                        onClick={() => append({ bean_id: '', ratio_pct: 0 })}
                    >
                        + 생두 추가
                    </button>
                </div>

                {/* Footer */}
                <div className="!mt-8 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-white text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                    >
                        취소
                    </button>
                    <button
                        type="submit"
                        disabled={!isValid}
                        className="flex-1 py-3.5 rounded-2xl border border-transparent dark:border-white bg-primary dark:bg-black text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {editing ? '저장' : '추가'}
                    </button>
                </div>
            </form>
        </ModalShell>
    );
};
