import { profileKeys } from '@shared/lib/query-keys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoastingStore } from '../../features/active-roast/model/status';
import { protectRoastSession } from '../../roastAuthProtection';

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
    let stopProtection: (() => void) | undefined;

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
            sessionProtectionActive: false,
            reauthenticationRequired: false,
        });
        cleanup = useAuthStore.getState().init();
    });

    afterEach(() => {
        cleanup?.();
        stopProtection?.();
        useRoastingStore.setState(useRoastingStore.getInitialState());
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
        expect(await useAuthStore.getState().signOut()).toBe(true);
        expect(signOut).toHaveBeenCalledWith({ scope: 'local' });

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

    it.each(['preheating', 'standby', 'roasting', 'ended'] as const)(
        'preserves the operator and plan on auth loss during %s, including repeated auth events',
        (phase) => {
            stopProtection = protectRoastSession();
            authCb?.('SIGNED_IN', { user });
            useRoastingStore.setState({ phase });
            removeQueries.mockClear();

            authCb?.('SIGNED_OUT', null);
            authCb?.('INITIAL_SESSION', null);

            expect(useAuthStore.getState()).toMatchObject({
                user,
                reauthenticationRequired: true,
                oauthPending: false,
                loading: false,
                oauthError: null,
            });
            expect(removeQueries).not.toHaveBeenCalled();
            expect(sendOsNotification).not.toHaveBeenCalled();
        },
    );

    it('blocks explicit sign-out before touching Supabase while the machine is connected', async () => {
        stopProtection = protectRoastSession();
        authCb?.('SIGNED_IN', { user });
        useRoastingStore.setState({ sidecarConnected: true });

        expect(await useAuthStore.getState().signOut()).toBe(false);
        expect(signOut).not.toHaveBeenCalled();
        expect(useAuthStore.getState().user).toEqual(user);
    });

    it('requires login only after machine work is finished and the connection is released', () => {
        stopProtection = protectRoastSession();
        authCb?.('SIGNED_IN', { user });
        useRoastingStore.setState({ phase: 'roasting', sidecarConnected: true });
        authCb?.('SIGNED_OUT', null);
        removeQueries.mockClear();

        useRoastingStore.setState({ phase: 'standby' });
        expect(useAuthStore.getState().user).toEqual(user);
        useRoastingStore.setState({ sidecarConnected: false, phase: 'roasting' });
        expect(useAuthStore.getState().user).toEqual(user);
        useRoastingStore.setState({ phase: 'idle' });

        expect(useAuthStore.getState()).toMatchObject({
            user: null,
            reauthenticationRequired: false,
            sessionProtectionActive: false,
            oauthError: 'session_expired',
        });
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: profileKeys.detail('user-1') });
    });

    it('recovers same-account auth without clearing the running plan or signing out at disconnect', () => {
        stopProtection = protectRoastSession();
        authCb?.('SIGNED_IN', { user });
        useRoastingStore.setState({ phase: 'roasting' });
        authCb?.('SIGNED_OUT', null);
        removeQueries.mockClear();

        authCb?.('TOKEN_REFRESHED', { user });
        expect(useAuthStore.getState().reauthenticationRequired).toBe(false);
        expect(removeQueries).not.toHaveBeenCalled();
        useRoastingStore.setState({ phase: 'idle' });
        expect(useAuthStore.getState().user).toEqual(user);
    });

    it('does not switch the operator if a different account appears during roasting', () => {
        stopProtection = protectRoastSession();
        authCb?.('SIGNED_IN', { user });
        useRoastingStore.setState({ phase: 'roasting' });
        authCb?.('SIGNED_IN', { user: { id: 'other-user' } });
        expect(useAuthStore.getState()).toMatchObject({ user, reauthenticationRequired: true });
    });

    it.each([true, false])(
        'protects Charge during a pending sign-out (SDK event before Charge: %s)',
        async (eventFirst) => {
            stopProtection = protectRoastSession();
            authCb?.('SIGNED_IN', { user });
            let resolveSignOut: ((value: { error: null }) => void) | undefined;
            signOut.mockReturnValue(new Promise((resolve) => (resolveSignOut = resolve)));
            const request = useAuthStore.getState().signOut();
            if (eventFirst) authCb?.('SIGNED_OUT', null);
            expect(useAuthStore.getState().user).toEqual(user);
            useRoastingStore.getState().startCharge();

            if (!eventFirst) authCb?.('SIGNED_OUT', null);
            resolveSignOut?.({ error: null });
            expect(await request).toBe(false);
            expect(useAuthStore.getState()).toMatchObject({ user, reauthenticationRequired: true });
            expect(useRoastingStore.getState().phase).toBe('roasting');
        },
    );

    it('protects existing machine work before a remounted auth initializer falls back to getSession', async () => {
        authCb?.('SIGNED_IN', { user });
        useRoastingStore.setState({ phase: 'roasting' });
        stopProtection = protectRoastSession();
        cleanup?.();
        useAuthStore.setState({ loading: true });
        getSession.mockResolvedValue({ data: { session: null } });
        cleanup = useAuthStore.getState().init();
        await Promise.resolve();
        expect(useAuthStore.getState()).toMatchObject({ user, reauthenticationRequired: true, loading: false });
    });
});
