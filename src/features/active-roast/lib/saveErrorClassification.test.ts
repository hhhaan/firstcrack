import { BatchLimitError } from '@shared/lib/features';
import { describe, expect, it } from 'vitest';
import { isPermanentSaveError, pgErrorCode } from './saveErrorClassification';

describe('pgErrorCode', () => {
    it('reads a string code off a PostgREST error', () => {
        expect(pgErrorCode({ code: '23514', message: 'violates check constraint' })).toBe('23514');
    });

    it('returns null for errors without a usable code', () => {
        expect(pgErrorCode(new Error('boom'))).toBeNull();
        expect(pgErrorCode({ code: 23514 })).toBeNull();
        expect(pgErrorCode(null)).toBeNull();
        expect(pgErrorCode('23514')).toBeNull();
    });
});

describe('isPermanentSaveError', () => {
    it('treats integrity violations as permanent', () => {
        // output_weight_grams <= weight_grams — the case that used to loop forever (#181)
        expect(isPermanentSaveError({ code: '23514' })).toBe(true);
        expect(isPermanentSaveError({ code: '23503' })).toBe(true);
        expect(isPermanentSaveError({ code: '23505' })).toBe(true);
        expect(isPermanentSaveError({ code: '23502' })).toBe(true);
    });

    it('keeps transient and recoverable failures retryable', () => {
        expect(isPermanentSaveError(new Error('Failed to fetch'))).toBe(false);
        expect(isPermanentSaveError({ code: '57014' })).toBe(false);
        expect(isPermanentSaveError({ code: 'PGRST301' })).toBe(false);
        expect(isPermanentSaveError(undefined)).toBe(false);
    });

    it('keeps plan-gate refusals retryable — they clear on upgrade or next month', () => {
        expect(isPermanentSaveError(new BatchLimitError(0, 0, 'read_only_plan'))).toBe(false);
        expect(isPermanentSaveError(new BatchLimitError(50, 50, 'trial_batch_cap'))).toBe(false);
    });
});
