import { describe, expect, it } from 'vitest';
import { buildRoastStockEvents } from './buildRoastStockEvents';

describe('buildRoastStockEvents', () => {
    it('returns empty when deductionGrams <= 0', () => {
        expect(
            buildRoastStockEvents({
                userId: 'u1',
                deductionGrams: 0,
                singleBeanId: 'b1',
                blendId: null,
                referenceId: 'ref-1',
            }),
        ).toEqual([]);
    });

    it('throws when no bean and no blend', () => {
        expect(() =>
            buildRoastStockEvents({
                userId: 'u1',
                deductionGrams: 1000,
                singleBeanId: null,
                blendId: null,
                referenceId: 'ref-1',
            }),
        ).toThrow(/No bean linked/);
    });

    it('builds single-bean roast event with negative delta', () => {
        const events = buildRoastStockEvents({
            userId: 'u1',
            deductionGrams: 5000,
            singleBeanId: 'bean-1',
            blendId: null,
            referenceId: 'sess-9',
        });
        expect(events).toEqual([
            {
                user_id: 'u1',
                bean_id: 'bean-1',
                delta_grams: -5000,
                event_type: 'roast',
                reference_id: 'sess-9',
            },
        ]);
    });

    it('splits blend roast across components and preserves total', () => {
        const events = buildRoastStockEvents({
            userId: 'u1',
            deductionGrams: 1000,
            singleBeanId: null,
            blendId: 'blend-1',
            referenceId: 'sess-blend',
            blend: {
                name: 'House',
                blend_components: [
                    { bean_id: 'a', ratio_pct: 60 },
                    { bean_id: 'b', ratio_pct: 40 },
                ],
            },
        });
        expect(events).toHaveLength(2);
        expect(events.every((e) => e.event_type === 'roast' && e.reference_id === 'sess-blend')).toBe(true);
        expect(events.reduce((s, e) => s + e.delta_grams, 0)).toBe(-1000);
        expect(events[0]).toMatchObject({ bean_id: 'a', delta_grams: -600, note: 'House 블렌드 차감' });
        expect(events[1]).toMatchObject({ bean_id: 'b', delta_grams: -400 });
    });

    it('prefers blend path when both singleBeanId and blendId set', () => {
        const events = buildRoastStockEvents({
            userId: 'u1',
            deductionGrams: 100,
            singleBeanId: 'ignored',
            blendId: 'blend-1',
            referenceId: 'r',
            blend: {
                name: 'B',
                blend_components: [{ bean_id: 'c', ratio_pct: 100 }],
            },
        });
        expect(events).toHaveLength(1);
        expect(events[0].bean_id).toBe('c');
    });

    it('throws when blendId set but blend has no components', () => {
        expect(() =>
            buildRoastStockEvents({
                userId: 'u1',
                deductionGrams: 100,
                singleBeanId: null,
                blendId: 'blend-1',
                referenceId: 'r',
                blend: { name: 'Empty', blend_components: [] },
            }),
        ).toThrow(/No bean linked/);
    });
});
