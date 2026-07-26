import { describe, expect, it } from 'vitest';
import { resolveMutationErrorText } from './mutationErrorMessage';

describe('resolveMutationErrorText', () => {
    it('surfaces a server message the user can act on', () => {
        const error = Object.assign(new Error('new row violates row-level security policy'), { code: '42501' });
        expect(resolveMutationErrorText(error)).toEqual({
            key: 'errors.mutationFailedDetail',
            detail: 'new row violates row-level security policy',
        });
    });

    it('falls back to the generic copy for opaque transport failures', () => {
        expect(resolveMutationErrorText(new TypeError('Failed to fetch'))).toEqual({ key: 'errors.mutationFailed' });
    });

    it('falls back to the generic copy when there is no message at all', () => {
        expect(resolveMutationErrorText(new Error(''))).toEqual({ key: 'errors.mutationFailed' });
        expect(resolveMutationErrorText({ code: 'PGRST301' })).toEqual({ key: 'errors.mutationFailed' });
    });

    it('truncates long messages', () => {
        const result = resolveMutationErrorText(new Error('x'.repeat(400)));
        expect(result).toEqual({ key: 'errors.mutationFailedDetail', detail: `${'x'.repeat(160)}…` });
    });
});
