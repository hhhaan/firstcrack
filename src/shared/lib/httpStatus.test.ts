import { describe, expect, it } from 'vitest';
import { BatchLimitError } from './features/plan-matrix';
import { isClientSqlStateWarning, isDeterministicClientError, isExpectedRefusal } from './httpStatus';

describe('isExpectedRefusal', () => {
    it('matches plan gates, 42501, and 4xx except 429', () => {
        expect(isExpectedRefusal(new BatchLimitError(0, 0, 'read_only_plan'))).toBe(true);
        expect(isExpectedRefusal({ code: '23514', message: 'read_only_plan', details: 'x' })).toBe(true);
        expect(isExpectedRefusal({ code: '42501', message: 'permission denied' })).toBe(true);
        expect(isExpectedRefusal({ status: 404 })).toBe(true);
        expect(isExpectedRefusal({ status: 429 })).toBe(false);
        expect(isExpectedRefusal({ code: '42703', message: 'undefined column' })).toBe(false);
    });
});

describe('isClientSqlStateWarning', () => {
    it('flags 22/23/42 except 42501', () => {
        expect(isClientSqlStateWarning({ code: '42703', message: 'x' })).toBe(true);
        expect(isClientSqlStateWarning({ code: '23505', message: 'dup' })).toBe(true);
        expect(isClientSqlStateWarning({ code: '42501', message: 'rls' })).toBe(false);
        expect(isClientSqlStateWarning({ code: '08006', message: 'conn' })).toBe(false);
    });

    it('stays aligned with deterministic retry refusal', () => {
        const missingColumn = { code: '42703', message: 'column missing' };
        expect(isDeterministicClientError(missingColumn)).toBe(true);
        expect(isExpectedRefusal(missingColumn)).toBe(false);
    });
});
