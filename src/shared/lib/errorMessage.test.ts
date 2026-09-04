import { describe, expect, it } from 'vitest';
import { errorMessage, isOpaqueNetworkError, isSidecarStartingError } from './errorMessage';

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

describe('isSidecarStartingError', () => {
    it('treats WKWebView connection-refused and sidecar 401 as startup', () => {
        expect(isSidecarStartingError(new TypeError('Load failed'))).toBe(true);
        expect(isSidecarStartingError(new TypeError('Failed to fetch'))).toBe(true);
        expect(isSidecarStartingError(new Error('unauthorized'))).toBe(true);
    });

    it('leaves adapter/protocol failures alone', () => {
        expect(isSidecarStartingError(new Error('modbus handshake timeout'))).toBe(false);
        expect(isSidecarStartingError(new Error('HTTP 409'))).toBe(false);
    });
});
