import { beforeEach, describe, expect, it, vi } from 'vitest';

type AuthCb = (event: string, session: { user: { id: string } } | null) => void;

let authCb: AuthCb | null = null;
const unsubscribe = vi.fn();
const getSession = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const sendOsNotification = vi.fn();

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
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: () => Promise.resolve({ data: { plan: 'pro' }, error: null }),
                }),
            }),
        }),
    },
}));

vi.mock('../lib/osNotification', () => ({
    sendOsNotification: (...a: unknown[]) => sendOsNotification(...a),
}));

vi.mock('../lib/logger', () => ({
    logger: { capture: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn(), info: vi.fn() },
}));

vi.mock('i18next', () => ({
    default: { t: (k: string) => k },
}));

import { useAuthStore } from './auth';

const user = { id: 'user-1' };

describe('auth session_replaced (single-session UX)', () => {
    let cleanup: (() => void) | undefined;

    beforeEach(() => {
        authCb = null;
        unsubscribe.mockReset();
        getSession.mockReset();
        signInWithPassword.mockReset();
        signOut.mockReset();
        sendOsNotification.mockReset();
        // getSession resolves after init subscribed; keep loading true until we drive authCb
        getSession.mockReturnValue(new Promise(() => {}));
        signOut.mockResolvedValue({ error: null });
        useAuthStore.setState({
            user: null,
            plan: 'free',
            loading: true,
            oauthPending: false,
            oauthError: null,
        });
        cleanup?.();
        cleanup = useAuthStore.getState().init();
    });

    it('sets session_replaced + OS notice when session ends without intentional signOut', () => {
        authCb?.('SIGNED_IN', { user });
        expect(useAuthStore.getState().user?.id).toBe('user-1');

        authCb?.('SIGNED_OUT', null);

        expect(useAuthStore.getState().user).toBeNull();
        expect(useAuthStore.getState().oauthError).toBe('session_replaced');
        expect(sendOsNotification).toHaveBeenCalledWith('auth.sessionReplacedTitle', 'auth.errors.session_replaced');
    });

    it('does not set session_replaced on intentional signOut', async () => {
        authCb?.('SIGNED_IN', { user });
        await useAuthStore.getState().signOut();

        // store already cleared by signOut; auth event should stay quiet
        authCb?.('SIGNED_OUT', null);

        expect(useAuthStore.getState().oauthError).toBeNull();
        expect(sendOsNotification).not.toHaveBeenCalled();
    });

    it('does not set session_replaced when never signed in', () => {
        authCb?.('INITIAL_SESSION', null);
        expect(useAuthStore.getState().oauthError).toBeNull();
        expect(sendOsNotification).not.toHaveBeenCalled();
    });
});
