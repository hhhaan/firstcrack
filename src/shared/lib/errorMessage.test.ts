import { describe, expect, it } from 'vitest';
import { errorMessage, isOpaqueNetworkError } from './errorMessage';

describe('errorMessage', () => {
    it('reads Error, string, and { message }', () => {
        expect(errorMessage(new Error('boom'))).toBe('boom');
        expect(errorMessage('plain')).toBe('plain');
        expect(errorMessage({ message: 'from object' })).toBe('from object');
        expect(errorMessage(null)).toBe('');
        expect(errorMessage({ code: 'PGRST301' })).toBe('');
    });
});

describe('isOpaqueNetworkError', () => {
    it('treats TypeError and failed-to-fetch hedges as opaque', () => {
        expect(isOpaqueNetworkError(new TypeError('Failed to fetch'))).toBe(true);
        expect(isOpaqueNetworkError(new Error('Failed to fetch'))).toBe(true);
        expect(isOpaqueNetworkError(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
        expect(isOpaqueNetworkError(new Error('network request failed'))).toBe(true);
        expect(isOpaqueNetworkError({ message: 'load failed' })).toBe(true);
    });

    it('leaves actionable server text alone', () => {
        expect(isOpaqueNetworkError(new Error('new row violates row-level security policy'))).toBe(false);
        expect(isOpaqueNetworkError(new Error('invite_expired'))).toBe(false);
        expect(isOpaqueNetworkError(new Error(''))).toBe(false);
        expect(isOpaqueNetworkError({ code: 'PGRST301' })).toBe(false);
    });
});
