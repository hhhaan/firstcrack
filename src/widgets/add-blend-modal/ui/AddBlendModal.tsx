import { useBeans } from '@entities/bean';
import type { BlendWithComponents } from '@entities/blend';
import { blendWriteErrorMessage, useCreateBlend, useUpdateBlend } from '@entities/blend';
import { blendTotalRatio } from '@entities/blend/lib';
import { useActiveWorkspace } from '@entities/organization';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { formErrorCls, inputCls, labelCls, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { BlendComponentRow } from '@widgets/add-blend-modal/ui/BlendComponentRow';
import { useEffect, useState } from 'react';
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
    const [submitError, setSubmitError] = useState<string | null>(null);

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
        setSubmitError(null);
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
        setSubmitError(null);
        try {
            if (editing) {
                await updateBlend.mutateAsync({
                    id: editing.id,
                    patch: { name: data.name.trim(), description: data.description.trim() || undefined },
                    components: data.components,
                });
            } else {
                await createBlend.mutateAsync({
                    blend: {
                        name: data.name.trim(),
                        description: data.description.trim() || undefined,
                        user_id: userId,
                    },
                    components: data.components,
                });
            }
            onClose();
        } catch (error) {
            setSubmitError(blendWriteErrorMessage(error) ?? t('errors.mutationFailed'));
        }
    };

    const componentsError = errors.components?.root?.message ?? errors.components?.message ?? submitError;

    return (
        <ModalShell onClose={onClose} labelledBy="add-blend-modal-title" contentClassName={modalPanel.formMd}>
            <div className={modalHeaderChrome}>
                <ModalHeader
                    titleId="add-blend-modal-title"
                    title={editing ? t('beans.blend.modal.titleEdit') : t('beans.blend.modal.titleCreate')}
                    onClose={onClose}
                    closeLabel={t('common.close')}
                    className="px-8 pt-6 pb-5"
                />
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ModalScrollBody contentClassName="p-8 space-y-5">
                    <div>
                        <label className={labelCls}>{t('beans.blend.modal.nameLabel')}</label>
                        <input
                            {...register('name')}
                            className={inputCls}
                            placeholder={t('beans.blend.modal.namePlaceholder')}
                        />
                        {errors.name && <p className={formErrorCls}>{errors.name.message}</p>}
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
                        <div className="mb-3 flex items-center justify-between">
                            <label className={`${labelCls} mb-0`}>{t('beans.blend.modal.componentsLabel')}</label>
                            <span
                                className={`text-xs font-semibold ${totalRatio === 100 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}
                            >
                                {t('beans.blend.modal.totalRatio', { total: totalRatio })}
                            </span>
                        </div>
                        {componentsError && <p className={`mb-2 ${formErrorCls}`}>{componentsError}</p>}

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
                            className="mt-3 cursor-pointer text-sm font-medium text-primary underline"
                            onClick={() => append({ bean_id: '', ratio_pct: 0 })}
                        >
                            {t('beans.blend.modal.addComponent')}
                        </button>
                    </div>
                </ModalScrollBody>

                <ModalFooter
                    onCancel={onClose}
                    cancelLabel={t('beans.blend.modal.cancel')}
                    primaryType="submit"
                    primaryDisabled={!isValid}
                    primaryLabel={editing ? t('beans.blend.modal.save') : t('beans.blend.modal.add')}
                />
            </form>
        </ModalShell>
    );
};
