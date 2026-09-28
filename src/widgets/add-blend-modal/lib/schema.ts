import { BLEND_DUPLICATE_BEAN_MESSAGE, BLEND_RATIO_SUM_MESSAGE } from '@entities/blend/lib';
import { z } from 'zod';

const duplicateBean = (comps: { bean_id: string }[]) => {
    const ids = comps.map((c) => c.bean_id).filter((id) => id.length > 0);
    return new Set(ids).size === ids.length;
};

export const blendFormSchema = z.object({
    name: z.string().min(1, '블렌드 이름을 입력하세요').max(100),
    description: z.string().max(500),
    components: z
        .array(
            z.object({
                bean_id: z.string().min(1, '생두를 선택하세요'),
                ratio_pct: z.number().int().min(1).max(100),
            }),
        )
        .min(1, '최소 1개의 생두가 필요합니다')
        // Duplicate first: the resolver keeps one error per path, and this is the one to show.
        .refine(duplicateBean, { message: BLEND_DUPLICATE_BEAN_MESSAGE })
        .refine((comps) => comps.reduce((sum, c) => sum + c.ratio_pct, 0) === 100, {
            message: BLEND_RATIO_SUM_MESSAGE,
        }),
});

export type BlendForm = z.infer<typeof blendFormSchema>;
