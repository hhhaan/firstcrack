import { describe, expect, it } from 'vitest';
import { mapAuthError } from './mapAuthError';

describe('mapAuthError', () => {
    it('maps invalid credentials by code', () => {
        expect(mapAuthError({ code: 'invalid_credentials', message: 'x' })).toBe('invalid_credentials');
    });

    it('maps invalid login message', () => {
        expect(mapAuthError(new Error('Invalid login credentials'))).toBe('invalid_credentials');
    });

    it('maps network failures', () => {
        expect(mapAuthError(new TypeError('Failed to fetch'))).toBe('network');
        expect(mapAuthError(new Error('NetworkError when attempting to fetch resource.'))).toBe('network');
    });

    it('maps unknown to generic', () => {
        expect(mapAuthError(new Error('something else'))).toBe('generic');
        expect(mapAuthError(null)).toBe('generic');
    });
});
