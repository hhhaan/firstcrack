import { describe, expect, it } from 'vitest';
import { buildBlendingEvents } from './buildBlendingEvents';

const base = { userId: 'u1', blendId: 'x1', opId: 'op1' };

describe('buildBlendingEvents', () => {
    it('consumes each component and produces the blend', () => {
        const events = buildBlendingEvents({
            ...base,
            inputs: [
                { beanId: 'b1', grams: 3000 },
                { beanId: 'b2', grams: 2000 },
            ],
            outputGrams: 4900, // 핸들링 로스 100g 허용
        });
        expect(events).toEqual([
            {
                user_id: 'u1',
                bean_id: 'b1',
                blend_id: null,
                delta_grams: -3000,
                event_type: 'blend_consume',
                reference_id: 'op1',
                note: undefined,
            },
            {
                user_id: 'u1',
                bean_id: 'b2',
                blend_id: null,
                delta_grams: -2000,
                event_type: 'blend_consume',
                reference_id: 'op1',
                note: undefined,
            },
            {
                user_id: 'u1',
                bean_id: null,
                blend_id: 'x1',
                delta_grams: 4900,
                event_type: 'blend_produce',
                reference_id: 'op1',
                note: undefined,
            },
        ]);
    });

    it('drops zero-gram inputs, keeps the rest', () => {
        const events = buildBlendingEvents({
            ...base,
            inputs: [
                { beanId: 'b1', grams: 3000 },
                { beanId: 'b2', grams: 0 },
            ],
            outputGrams: 3000,
        });
        expect(events).toHaveLength(2);
    });

    it('rejects empty inputs or non-positive output', () => {
        expect(() => buildBlendingEvents({ ...base, inputs: [], outputGrams: 100 })).toThrow();
        expect(() =>
            buildBlendingEvents({ ...base, inputs: [{ beanId: 'b1', grams: 100 }], outputGrams: 0 }),
        ).toThrow();
    });

    it('rejects output above input sum', () => {
        expect(() =>
            buildBlendingEvents({
                ...base,
                inputs: [{ beanId: 'b1', grams: 200 }],
                outputGrams: 5000,
            }),
        ).toThrow('blend_output_exceeds_input');
    });

    it('rejects fractional grams', () => {
        expect(() =>
            buildBlendingEvents({
                ...base,
                inputs: [
                    { beanId: 'b1', grams: 100.5 },
                    { beanId: 'b2', grams: 100.5 },
                ],
                outputGrams: 201,
            }),
        ).toThrow('grams_must_be_whole');
    });
});
