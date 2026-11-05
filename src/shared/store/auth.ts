import type { User } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { profileKeys } from '../lib/query-keys';
import { supabase } from '../lib/supabase';

/** Bound once from `main.tsx`. Profile plan cache is Infinity-gc and must drop on auth change. */
let queryClient: QueryClient | undefined;

export function bindAuthQueryClient(qc: QueryClient): void {
    queryClient = qc;
}

function dropProfilePlanCache(userId: string | undefined): void {
    if (!userId) return;
    queryClient?.removeQueries({ queryKey: profileKeys.detail(userId) });
}

/** Stable auth UI error codes — no raw Supabase strings in UI. */
export type AuthErrorCode = 'invalid_credentials' | 'network' | 'oauth_failed' | 'session_expired' | 'generic';

const OAUTH_TIMEOUT_MS = 90_000;
let oauthTimeoutId: ReturnType<typeof setTimeout> | undefined;
/** Defer the SDK sign-out event until the pending action rechecks machine activity. */
let signOutPending = false;

const clearOAuthTimeout = () => {
    if (oauthTimeoutId) {
        clearTimeout(oauthTimeoutId);
        oauthTimeoutId = undefined;
    }
};

interface AuthState {
    /** Local operator identity; cloud access still requires a valid Supabase session. */
    user: User | null;
    loading: boolean;
    oauthPending: boolean;
    oauthError: AuthErrorCode | null;
    sessionProtectionActive: boolean;
    reauthenticationRequired: boolean;
}

interface AuthActions {
    /** App 최상단에서 한 번 호출. 반환값은 cleanup 함수. */
    init: () => () => void;
    /** Email + Password 로그인. 실패 시 에러 throw. */
    signInWithEmail: (email: string, password: string) => Promise<void>;
    /** Google OAuth 시작 — 브라우저 리다이렉트 대기 상태로 전환 */
    startOAuth: () => void;
    /** OAuth 실패/타임아웃 시 대기 상태 해제. 인자 없으면 조용히 취소(Cancel). */
    cancelOAuth: (error?: AuthErrorCode) => void;
    /** App composition supplies machine activity without a shared → feature dependency. */
    setSessionProtection: (active: boolean) => void;
    /** False while local machine work prevents sign-out. */
    signOut: () => Promise<boolean>;
}

/**
 * Cloud auth loss cannot terminate protected local machine work.
 * Plan SSoT is React Query (`useEffectivePlan` / `useProfile`), not this store.
 */
export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
    user: null,
    loading: true,
    oauthPending: false,
    oauthError: null,
    sessionProtectionActive: false,
    reauthenticationRequired: false,

    init: () => {
        // 5초 안에 auth 응답 없으면 강제로 loading 해제 (토큰 refresh hang 방어)
        const timeout = setTimeout(() => {
            if (get().loading) set({ loading: false });
        }, 5000);

        const applyUser = (next: User | null) => {
            clearTimeout(timeout);
            const prevUser = get().user;

            // Losing cloud auth must never unmount local controls or change batch ownership.
            // Keep the operator and cached plan until the machine work is explicitly finished.
            if (prevUser && get().sessionProtectionActive && next?.id !== prevUser.id) {
                clearOAuthTimeout();
                signOutPending = false;
                set({ reauthenticationRequired: true, loading: false, oauthPending: false, oauthError: null });
                return;
            }

            // The SDK emits SIGNED_OUT before signOut() resolves. Let the action commit
            // that logout after rechecking whether machine work started in the meantime.
            if (!next && prevUser && signOutPending) return;

            // Same user already applied (token refresh etc.)
            if (prevUser?.id === next?.id && !get().loading && !get().oauthPending && !get().reauthenticationRequired) {
                return;
            }

            clearOAuthTimeout();

            if (!next) {
                signOutPending = false;
                dropProfilePlanCache(prevUser?.id);
                set({
                    user: null,
                    loading: false,
                    oauthPending: false,
                    oauthError: null,
                    reauthenticationRequired: false,
                });
                return;
            }

            signOutPending = false;
            if (prevUser?.id !== next.id) dropProfilePlanCache(next.id);
            set({
                user: next,
                loading: false,
                oauthPending: false,
                oauthError: null,
                reauthenticationRequired: false,
            });
        };

        // onAuthStateChange hang 시 getSession으로 폴백. Both paths respect local protection.
        void supabase.auth.getSession().then(({ data: { session } }) => {
            if (get().loading) applyUser(session?.user ?? null);
        });

        // Keep this callback synchronous; auth methods here can deadlock the refresh lock.
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            applyUser(session?.user ?? null);
        });

        return () => {
            clearTimeout(timeout);
            clearOAuthTimeout();
            subscription.unsubscribe();
        };
    },

    signInWithEmail: async (email, password) => {
        signOutPending = false;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    },

    startOAuth: () => {
        clearOAuthTimeout();
        set({ oauthPending: true, oauthError: null });
        oauthTimeoutId = setTimeout(() => {
            if (get().oauthPending) {
                // User abandoned browser flow — expected, no Sentry
                set({
                    oauthPending: false,
                    oauthError: 'oauth_failed',
                });
            }
        }, OAUTH_TIMEOUT_MS);
    },

    cancelOAuth: (error) => {
        clearOAuthTimeout();
        set({ oauthPending: false, oauthError: error ?? null });
    },

    setSessionProtection: (active) => {
        const state = get();
        if (state.sessionProtectionActive === active) return;
        if (!active && state.reauthenticationRequired) {
            dropProfilePlanCache(state.user?.id);
            set({
                sessionProtectionActive: false,
                reauthenticationRequired: false,
                user: null,
                loading: false,
                oauthPending: false,
                oauthError: 'session_expired',
            });
            return;
        }
        set({ sessionProtectionActive: active });
    },

    signOut: async () => {
        if (get().sessionProtectionActive) return false;
        signOutPending = true;
        const prevId = get().user?.id;
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) {
            signOutPending = false;
            throw error;
        }
        signOutPending = false;
        clearOAuthTimeout();
        // Machine work may have started while signOut was awaiting the server.
        if (get().sessionProtectionActive) {
            signOutPending = false;
            set({ reauthenticationRequired: true, oauthPending: false });
            return false;
        }
        dropProfilePlanCache(prevId);
        set({ user: null, oauthPending: false, oauthError: null, reauthenticationRequired: false });
        return true;
    },
}));
