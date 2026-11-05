import { profileKeys } from '@shared/lib/query-keys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthCb = (event: string, session: { user: { id: string } } | null) => void;

let authCb: AuthCb | null = null;
const unsubscribe = vi.fn();
const getSession = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const sendOsNotification = vi.fn();
const from = vi.fn();

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: (...a: unknown[]) => getSession(...a),
            signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
            signOut: (...a: unknown[]) => signOut(...a),
            onAuthStateChange: (cb: AuthCb) => {
                authCb = cb;
                return { data: { subscription: { unsubscribe } } };
            },
        },
        from: (...a: unknown[]) => from(...a),
    },
}));

vi.mock('../lib/osNotification', () => ({
    sendOsNotification: (...a: unknown[]) => sendOsNotification(...a),
}));

import { bindAuthQueryClient, useAuthStore } from './auth';

const user = { id: 'user-1' };
const removeQueries = vi.fn();

describe('auth session lifecycle', () => {
    let cleanup: (() => void) | undefined;

    beforeEach(() => {
        authCb = null;
        unsubscribe.mockReset();
        getSession.mockReset();
        signInWithPassword.mockReset();
        signOut.mockReset();
        sendOsNotification.mockReset();
        from.mockReset();
        removeQueries.mockReset();
        bindAuthQueryClient({ removeQueries } as never);
        // Keep initialization pending until the test drives an auth event.
        getSession.mockReturnValue(new Promise(() => {}));
        signOut.mockResolvedValue({ error: null });
        useAuthStore.setState({
            user: null,
            loading: true,
            oauthPending: false,
            oauthError: null,
        });
        cleanup = useAuthStore.getState().init();
    });

    afterEach(() => {
        cleanup?.();
    });

    it('clears a terminated session without an auth error or OS notice', () => {
        authCb?.('SIGNED_IN', { user });
        expect(useAuthStore.getState().user?.id).toBe('user-1');
        useAuthStore.setState({ oauthPending: true, oauthError: 'oauth_failed' });

        authCb?.('SIGNED_OUT', null);

        expect(useAuthStore.getState()).toMatchObject({
            user: null,
            loading: false,
            oauthPending: false,
            oauthError: null,
        });
        expect(sendOsNotification).not.toHaveBeenCalled();
    });

    it.each(['before', 'after'])('signs out quietly when the auth event arrives %s the response', async (timing) => {
        authCb?.('SIGNED_IN', { user });
        if (timing === 'before') {
            signOut.mockImplementation(async () => {
                authCb?.('SIGNED_OUT', null);
                return { error: null };
            });
        }
        await useAuthStore.getState().signOut();

        if (timing === 'after') authCb?.('SIGNED_OUT', null);

        expect(useAuthStore.getState().user).toBeNull();
        expect(useAuthStore.getState().oauthError).toBeNull();
        expect(sendOsNotification).not.toHaveBeenCalled();
    });

    it('initializes without a session quietly', () => {
        authCb?.('INITIAL_SESSION', null);
        expect(useAuthStore.getState().oauthError).toBeNull();
        expect(sendOsNotification).not.toHaveBeenCalled();
    });

    it('does not fetch profiles.plan', () => {
        authCb?.('SIGNED_IN', { user });
        expect(from).not.toHaveBeenCalled();
        expect(useAuthStore.getState()).not.toHaveProperty('plan');
    });

    it('clears profile plan cache on SIGNED_IN and logout', async () => {
        authCb?.('SIGNED_IN', { user });
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: profileKeys.detail('user-1') });

        removeQueries.mockClear();
        await useAuthStore.getState().signOut();
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: profileKeys.detail('user-1') });
    });

    it('clears profile plan cache on SIGNED_OUT', () => {
        authCb?.('SIGNED_IN', { user });
        removeQueries.mockClear();
        authCb?.('SIGNED_OUT', null);
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: profileKeys.detail('user-1') });
    });

    it('preserves the user and cache when signOut fails', async () => {
        authCb?.('SIGNED_IN', { user });
        removeQueries.mockClear();
        const error = new Error('sign-out failed');
        signOut.mockResolvedValue({ error });

        await expect(useAuthStore.getState().signOut()).rejects.toBe(error);

        expect(useAuthStore.getState().user).toEqual(user);
        expect(removeQueries).not.toHaveBeenCalled();
        expect(sendOsNotification).not.toHaveBeenCalled();
    });

    it('keeps the signed-in user and cache on token refresh', () => {
        authCb?.('SIGNED_IN', { user });
        removeQueries.mockClear();

        authCb?.('TOKEN_REFRESHED', { user });

        expect(useAuthStore.getState().user).toEqual(user);
        expect(useAuthStore.getState().oauthError).toBeNull();
        expect(removeQueries).not.toHaveBeenCalled();
        expect(sendOsNotification).not.toHaveBeenCalled();
    });
});
