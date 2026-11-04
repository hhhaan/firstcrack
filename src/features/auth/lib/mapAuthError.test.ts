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

    it('maps already-registered signup', () => {
        expect(mapAuthError({ code: 'user_already_exists', message: 'x' })).toBe('user_already_registered');
        expect(mapAuthError({ code: 'user_already_registered', message: 'x' })).toBe('user_already_registered');
        expect(mapAuthError(new Error('User already registered'))).toBe('user_already_registered');
    });

    it('maps weak password', () => {
        expect(mapAuthError({ code: 'weak_password', message: 'x' })).toBe('weak_password');
        expect(mapAuthError(new Error('Password should be at least 8 characters'))).toBe('weak_password');
    });

    it('maps password mismatch by code', () => {
        expect(mapAuthError({ code: 'password_mismatch', message: 'x' })).toBe('password_mismatch');
    });

    it('maps unconfirmed email on sign-in', () => {
        expect(mapAuthError({ code: 'email_not_confirmed', message: 'x' })).toBe('email_not_confirmed');
        expect(mapAuthError(new Error('Email not confirmed'))).toBe('email_not_confirmed');
    });
});
