import { z } from 'zod';

export const buildBlendFormSchema = (t: (key: string) => string) =>
    z.object({
        name: z.string().min(1, t('beans.blend.modal.form.nameRequired')).max(100),
        description: z.string().max(500),
        components: z
            .array(
                z.object({
                    bean_id: z.string().min(1, t('beans.blend.modal.form.beanRequired')),
                    ratio_pct: z.number().int().min(1).max(100),
                }),
            )
            .min(1, t('beans.blend.modal.form.componentsMin'))
            .refine((comps) => comps.reduce((sum, c) => sum + c.ratio_pct, 0) === 100, {
                message: t('beans.blend.modal.form.ratioSum'),
            }),
    });

export type BlendForm = z.infer<ReturnType<typeof buildBlendFormSchema>>;
