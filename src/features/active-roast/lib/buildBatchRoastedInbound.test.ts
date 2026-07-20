import { describe, expect, it } from 'vitest';
import { buildBatchRoastedInbound } from './buildBatchRoastedInbound';

const base = {
    userId: 'u1',
    deductionGrams: 10000,
    beanId: 'bean-1',
    blendId: null,
    referenceId: 'batch-1',
    roastLevel: 'Medium',
};

describe('buildBatchRoastedInbound', () => {
    it('books estimated inbound from green deduction (single bean)', () => {
        expect(buildBatchRoastedInbound(base)).toEqual({
            user_id: 'u1',
            bean_id: 'bean-1',
            blend_id: null,
            delta_grams: 8500, // Medium → 0.85
            event_type: 'roast_inbound',
            reference_id: 'batch-1',
            is_estimate: true,
        });
    });

    it('attributes to blend when blendId present (blend wins over bean)', () => {
        const e = buildBatchRoastedInbound({ ...base, blendId: 'blend-1' });
        expect(e?.blend_id).toBe('blend-1');
        expect(e?.bean_id).toBeNull();
    });

    it('falls back to default shrink factor when level unknown', () => {
        expect(buildBatchRoastedInbound({ ...base, roastLevel: null })?.delta_grams).toBe(8200);
    });

    it('returns null when nothing to book', () => {
        expect(buildBatchRoastedInbound({ ...base, deductionGrams: 0 })).toBeNull();
        expect(buildBatchRoastedInbound({ ...base, beanId: null })).toBeNull();
    });
});
