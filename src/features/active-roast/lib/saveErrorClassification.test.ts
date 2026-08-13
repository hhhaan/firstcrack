import { describe, expect, it } from 'vitest';
import { isPermanentSaveError, pgErrorCode } from './saveErrorClassification';

describe('isPermanentSaveError', () => {
    it('treats the whole 23xxx class as permanent', () => {
        expect(isPermanentSaveError({ code: '23503' })).toBe(true);
        expect(isPermanentSaveError({ code: '23514' })).toBe(true);
        expect(isPermanentSaveError({ code: '23502' })).toBe(true);
        expect(isPermanentSaveError({ code: '23505' })).toBe(true);
    });

    it('leaves transient and plan-gate errors retryable', () => {
        expect(isPermanentSaveError(new Error('network'))).toBe(false);
        expect(isPermanentSaveError({ code: '57014' })).toBe(false);
        expect(isPermanentSaveError({ message: 'trial_expired' })).toBe(false);
    });
});

describe('pgErrorCode', () => {
    it('reads code from a PostgREST-shaped object', () => {
        expect(pgErrorCode({ code: '23514' })).toBe('23514');
        expect(pgErrorCode(new Error('x'))).toBeNull();
    });
});
