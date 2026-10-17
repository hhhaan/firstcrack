import { describe, expect, it } from 'vitest';
import { blendFormSchema } from './schema';

const valid = {
    name: 'House Blend',
    description: 'daily',
    components: [
        { bean_id: 'b1', ratio_pct: 60 },
        { bean_id: 'b2', ratio_pct: 40 },
    ],
};

describe('blendFormSchema', () => {
    it('accepts name + components whose ratios sum to 100', () => {
        const result = blendFormSchema.safeParse(valid);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe('House Blend');
            expect(result.data.components).toHaveLength(2);
        }
    });

    it('rejects empty name', () => {
        const result = blendFormSchema.safeParse({ ...valid, name: '' });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === '블렌드 이름을 입력하세요')).toBe(true);
        }
    });

    it('requires at least one component', () => {
        const result = blendFormSchema.safeParse({ ...valid, components: [] });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === '최소 1개의 생두가 필요합니다')).toBe(true);
        }
    });

    it('rejects ratio sum not equal to 100', () => {
        const result = blendFormSchema.safeParse({
            ...valid,
            components: [
                { bean_id: 'b1', ratio_pct: 50 },
                { bean_id: 'b2', ratio_pct: 40 },
            ],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === '구성 비율 합계가 100%여야 합니다')).toBe(true);
        }
    });

    it('rejects empty bean_id and non-integer / out-of-range ratio', () => {
        const emptyBean = blendFormSchema.safeParse({
            ...valid,
            components: [{ bean_id: '', ratio_pct: 100 }],
        });
        expect(emptyBean.success).toBe(false);
        if (!emptyBean.success) {
            expect(emptyBean.error.issues.some((i) => i.message === '생두를 선택하세요')).toBe(true);
        }

        const frac = blendFormSchema.safeParse({
            ...valid,
            components: [
                { bean_id: 'b1', ratio_pct: 50.5 },
                { bean_id: 'b2', ratio_pct: 49.5 },
            ],
        });
        expect(frac.success).toBe(false);
        if (!frac.success) {
            expect(frac.error.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ code: 'invalid_type', expected: 'integer', received: 'float' }),
                ]),
            );
            expect(frac.error.issues.some((i) => i.message === '구성 비율 합계가 100%여야 합니다')).toBe(false);
        }

        const over = blendFormSchema.safeParse({
            ...valid,
            components: [{ bean_id: 'b1', ratio_pct: 101 }],
        });
        expect(over.success).toBe(false);
        if (!over.success) {
            expect(over.error.issues).toContainEqual(
                expect.objectContaining({ code: 'too_big', maximum: 100, path: ['components', 0, 'ratio_pct'] }),
            );
        }
    });
});
