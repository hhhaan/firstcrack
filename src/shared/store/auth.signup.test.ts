import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const signInWithPassword = vi.fn();
const signUp = vi.fn();
const signOut = vi.fn();
const unsubscribe = vi.fn();

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: (...a: unknown[]) => getSession(...a),
            signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
            signUp: (...a: unknown[]) => signUp(...a),
            signOut: (...a: unknown[]) => signOut(...a),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
        },
    },
}));

vi.mock('../lib/osNotification', () => ({
    sendOsNotification: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
    logger: { capture: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn(), info: vi.fn() },
}));

vi.mock('i18next', () => ({
    default: { t: (k: string) => k },
}));

import { useAuthStore } from './auth';

describe('signUpWithEmail', () => {
    beforeEach(() => {
        signUp.mockReset();
        useAuthStore.setState({
            user: null,
            loading: false,
            oauthPending: false,
            oauthError: null,
        });
    });

    it('returns session when signUp yields a session', async () => {
        signUp.mockResolvedValue({
            data: {
                user: { id: 'u1', identities: [{ id: 'i1' }] },
                session: { user: { id: 'u1' } },
            },
            error: null,
        });

        await expect(useAuthStore.getState().signUpWithEmail('a@b.com', 'password1')).resolves.toBe('session');
        expect(signUp).toHaveBeenCalledWith({
            email: 'a@b.com',
            password: 'password1',
            options: { emailRedirectTo: 'https://firstcrackiscoming.com/auth/callback?next=%2F' },
        });
    });

    it('returns confirm_email when there is a user and no session', async () => {
        signUp.mockResolvedValue({
            data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null },
            error: null,
        });

        await expect(useAuthStore.getState().signUpWithEmail('a@b.com', 'password1')).resolves.toBe('confirm_email');
    });

    it('throws user_already_registered when identities is empty', async () => {
        signUp.mockResolvedValue({
            data: { user: { id: 'u1', identities: [] }, session: null },
            error: null,
        });

        await expect(useAuthStore.getState().signUpWithEmail('a@b.com', 'password1')).rejects.toMatchObject({
            code: 'user_already_registered',
        });
    });

    it('throws supabase error', async () => {
        const err = { code: 'weak_password', message: 'too short' };
        signUp.mockResolvedValue({ data: { user: null, session: null }, error: err });

        await expect(useAuthStore.getState().signUpWithEmail('a@b.com', 'short')).rejects.toBe(err);
    });
});
