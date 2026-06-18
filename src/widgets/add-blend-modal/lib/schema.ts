import { z } from 'zod';

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
        .refine((comps) => comps.reduce((sum, c) => sum + c.ratio_pct, 0) === 100, {
            message: '구성 비율 합계가 100%여야 합니다',
        }),
});

export type BlendForm = z.infer<typeof blendFormSchema>;
