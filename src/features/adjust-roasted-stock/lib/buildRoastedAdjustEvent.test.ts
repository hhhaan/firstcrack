import { describe, expect, it } from 'vitest';
import { buildRoastedAdjustEvent } from './buildRoastedAdjustEvent';

const base = {
    userId: 'u1',
    beanId: 'bean-1',
    blendId: null,
    type: 'adjustment' as const,
    sign: '+' as const,
    grams: 500,
    note: '실사 보정',
    referenceId: 'ref-1',
};

describe('buildRoastedAdjustEvent', () => {
    it('positive adjustment', () => {
        expect(buildRoastedAdjustEvent(base)).toEqual({
            user_id: 'u1',
            bean_id: 'bean-1',
            blend_id: null,
            delta_grams: 500,
            event_type: 'adjustment',
            reference_id: 'ref-1',
            note: '실사 보정',
        });
    });

    it('negative adjustment', () => {
        expect(buildRoastedAdjustEvent({ ...base, sign: '-' })?.delta_grams).toBe(-500);
    });

    it('write_off is always negative regardless of sign', () => {
        expect(buildRoastedAdjustEvent({ ...base, type: 'write_off', sign: '+' })?.delta_grams).toBe(-500);
        expect(buildRoastedAdjustEvent({ ...base, type: 'write_off', sign: '+' })?.event_type).toBe('write_off');
    });

    it('blend target zeroes bean_id', () => {
        const e = buildRoastedAdjustEvent({ ...base, beanId: null, blendId: 'blend-1' });
        expect(e?.blend_id).toBe('blend-1');
        expect(e?.bean_id).toBeNull();
    });

    it('null when no amount or no target', () => {
        expect(buildRoastedAdjustEvent({ ...base, grams: 0 })).toBeNull();
        expect(buildRoastedAdjustEvent({ ...base, beanId: null })).toBeNull();
    });

    it('empty note becomes null', () => {
        expect(buildRoastedAdjustEvent({ ...base, note: '  ' })?.note).toBeNull();
    });
});
