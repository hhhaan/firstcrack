import type { TFunction } from 'i18next';
import { z } from 'zod';

export const blendFormSchema = (t: TFunction) =>
    z.object({
        name: z.string().min(1, t('beans.blend.validation.nameRequired')).max(100),
        description: z.string().max(500),
        components: z
            .array(
                z.object({
                    bean_id: z.string().min(1, t('beans.blend.validation.beanRequired')),
                    ratio_pct: z.number().int().min(1).max(100),
                }),
            )
            .min(1, t('beans.blend.validation.minComponents'))
            .refine((comps) => comps.reduce((sum, c) => sum + c.ratio_pct, 0) === 100, {
                message: t('beans.blend.validation.ratioSum'),
            }),
    });

export type BlendForm = z.infer<ReturnType<typeof blendFormSchema>>;
