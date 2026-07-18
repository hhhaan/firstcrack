import { useBeans } from '@entities/bean';
import type { BlendWithComponents } from '@entities/blend';
import { useCreateBlend, useUpdateBlend } from '@entities/blend';
import { blendTotalRatio } from '@entities/blend/lib';
import { useActiveWorkspace } from '@entities/organization';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { inputCls, labelCls } from '@shared/ui/form-styles';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { BlendComponentRow } from '@widgets/add-blend-modal/ui/BlendComponentRow';
import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { type BlendForm, blendFormSchema } from '../lib/schema';

type Props = {
    open: boolean;
    onClose: () => void;
    editing?: BlendWithComponents | null;
};

export const AddBlendModal = ({ open, onClose, editing }: Props) => {
    const { t } = useTranslation();
    const { workspaceOwnerId: userId } = useActiveWorkspace();
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
    const totalRatio = blendTotalRatio(components ?? []);

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
        <ModalShell onClose={onClose} labelledBy="add-blend-modal-title" contentClassName={modalPanel.formMd}>
            <div className="shrink-0 bg-white/60 dark:bg-[#1a1e23] backdrop-blur-sm z-10 border-b border-black/4 dark:border-[#585d61]">
                <ModalHeader
                    titleId="add-blend-modal-title"
                    title={editing ? t('beans.blend.modal.titleEdit') : t('beans.blend.modal.titleCreate')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <ModalScrollBody contentClassName="p-8 space-y-4">
                    <div>
                        <label className={labelCls}>{t('beans.blend.modal.nameLabel')}</label>
                        <input
                            {...register('name')}
                            className={inputCls}
                            placeholder={t('beans.blend.modal.namePlaceholder')}
                        />
                        {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name.message}</p>}
                    </div>

                    <div>
                        <label className={labelCls}>{t('beans.blend.modal.descriptionLabel')}</label>
                        <input
                            {...register('description')}
                            className={inputCls}
                            placeholder={t('beans.blend.modal.descriptionPlaceholder')}
                        />
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <label className={`${labelCls} mb-0`}>{t('beans.blend.modal.componentsLabel')}</label>
                            <span
                                className={`text-xs font-semibold ${totalRatio === 100 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}
                            >
                                {t('beans.blend.modal.totalRatio', { total: totalRatio })}
                            </span>
                        </div>
                        {errors.components?.root && (
                            <p className="text-[11px] text-red-500 mb-2">{errors.components.root.message}</p>
                        )}

                        <div className="space-y-2">
                            {fields.map((field, idx) => (
                                <BlendComponentRow
                                    key={field.id}
                                    index={idx}
                                    register={register}
                                    beans={beans}
                                    canRemove={fields.length > 1}
                                    onRemove={() => remove(idx)}
                                />
                            ))}
                        </div>

                        <button
                            type="button"
                            className="mt-3 text-sm text-primary font-medium underline cursor-pointer"
                            onClick={() => append({ bean_id: '', ratio_pct: 0 })}
                        >
                            {t('beans.blend.modal.addComponent')}
                        </button>
                    </div>

                    <div className="!mt-8 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3.5 rounded-2xl border-none bg-surface dark:bg-surface-elevated text-secondary dark:text-[#e5e5e5] text-[15px] font-semibold cursor-pointer shadow-(--shadow-inset)"
                        >
                            {t('beans.blend.modal.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={!isValid}
                            className="flex-1 py-3.5 rounded-2xl border border-transparent dark:border-white bg-primary dark:bg-black text-white text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.15)] transition-opacity duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {editing ? t('beans.blend.modal.save') : t('beans.blend.modal.add')}
                        </button>
                    </div>
                </ModalScrollBody>
            </form>
        </ModalShell>
    );
};
