import { describe, expect, it } from 'vitest';
import { blendFormSchema } from './schema';

const t = (key: string) => key;
const schema = blendFormSchema(t as never);

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
        const result = schema.safeParse(valid);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe('House Blend');
            expect(result.data.components).toHaveLength(2);
        }
    });

    it('rejects empty name', () => {
        const result = schema.safeParse({ ...valid, name: '' });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === 'beans.blend.validation.nameRequired')).toBe(true);
        }
    });

    it('requires at least one component', () => {
        const result = schema.safeParse({ ...valid, components: [] });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === 'beans.blend.validation.minComponents')).toBe(true);
        }
    });

    it('rejects ratio sum not equal to 100', () => {
        const result = schema.safeParse({
            ...valid,
            components: [
                { bean_id: 'b1', ratio_pct: 50 },
                { bean_id: 'b2', ratio_pct: 40 },
            ],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === 'beans.blend.validation.ratioSum')).toBe(true);
        }
    });

    it('rejects empty bean_id and non-integer / out-of-range ratio', () => {
        const emptyBean = schema.safeParse({
            ...valid,
            components: [{ bean_id: '', ratio_pct: 100 }],
        });
        expect(emptyBean.success).toBe(false);
        if (!emptyBean.success) {
            expect(emptyBean.error.issues.some((i) => i.message === 'beans.blend.validation.beanRequired')).toBe(true);
        }

        const frac = schema.safeParse({
            ...valid,
            components: [{ bean_id: 'b1', ratio_pct: 50.5 }],
        });
        expect(frac.success).toBe(false);

        const over = schema.safeParse({
            ...valid,
            components: [{ bean_id: 'b1', ratio_pct: 101 }],
        });
        expect(over.success).toBe(false);
    });
});
