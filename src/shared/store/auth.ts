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
export type AuthErrorCode =
    | 'invalid_credentials'
    | 'network'
    | 'oauth_failed'
    | 'user_already_registered'
    | 'weak_password'
    | 'password_mismatch'
    | 'email_not_confirmed'
    | 'password_reset_failed'
    | 'generic';

export type SignUpResult = 'session' | 'confirm_email';

const SIGNUP_EMAIL_REDIRECT = 'https://firstcrackiscoming.com/auth/callback?next=%2F';

const OAUTH_TIMEOUT_MS = 90_000;
let oauthTimeoutId: ReturnType<typeof setTimeout> | undefined;

const clearOAuthTimeout = () => {
    if (oauthTimeoutId) {
        clearTimeout(oauthTimeoutId);
        oauthTimeoutId = undefined;
    }
};

interface AuthState {
    user: User | null;
    loading: boolean;
    oauthPending: boolean;
    oauthError: AuthErrorCode | null;
}

interface AuthActions {
    /** App 최상단에서 한 번 호출. 반환값은 cleanup 함수. */
    init: () => () => void;
    /** Email + Password 로그인. 실패 시 에러 throw. */
    signInWithEmail: (email: string, password: string) => Promise<void>;
    /** Email + Password 가입. 세션이 오면 `session`, 확인 메일이면 `confirm_email`. */
    signUpWithEmail: (email: string, password: string) => Promise<SignUpResult>;
    /** Google OAuth 시작 — 브라우저 리다이렉트 대기 상태로 전환 */
    startOAuth: () => void;
    /** OAuth 실패/타임아웃 시 대기 상태 해제. 인자 없으면 조용히 취소(Cancel). */
    cancelOAuth: (error?: AuthErrorCode) => void;
    /** 로그아웃 */
    signOut: () => Promise<void>;
}

/**
 * Plan SSoT is React Query (`useEffectivePlan` / `useProfile`), not this store.
 */
export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
    user: null,
    loading: true,
    oauthPending: false,
    oauthError: null,

    init: () => {
        // 5초 안에 auth 응답 없으면 강제로 loading 해제 (토큰 refresh hang 방어)
        const timeout = setTimeout(() => {
            if (get().loading) set({ user: null, loading: false });
        }, 5000);

        // onAuthStateChange hang 시 getSession으로 폴백
        void supabase.auth.getSession().then(({ data: { session } }) => {
            if (!get().loading) return;
            clearTimeout(timeout);
            const next = session?.user ?? null;
            set({
                user: next,
                loading: false,
                oauthPending: false,
                oauthError: null,
            });
        });

        // onAuthStateChange는 동기 콜백이어야 함 — async 사용 금지
        // Supabase v2: subscribe 시점에 INITIAL_SESSION으로 즉시 발화
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            clearTimeout(timeout);

            const prevUser = get().user;
            const next = session?.user ?? null;

            // Same user already applied (token refresh etc.)
            if (get().user?.id === next?.id && !get().loading && !get().oauthPending) {
                return;
            }

            clearOAuthTimeout();

            if (!next) {
                dropProfilePlanCache(prevUser?.id);
                set({
                    user: null,
                    loading: false,
                    oauthPending: false,
                    oauthError: null,
                });
                return;
            }

            dropProfilePlanCache(next.id);
            set({
                user: next,
                loading: false,
                oauthPending: false,
                oauthError: null,
            });
        });

        return () => {
            clearTimeout(timeout);
            clearOAuthTimeout();
            subscription.unsubscribe();
        };
    },

    signInWithEmail: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    },

    signUpWithEmail: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: SIGNUP_EMAIL_REDIRECT },
        });
        if (error) throw error;
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
            const already = Object.assign(new Error('User already registered'), {
                code: 'user_already_registered',
            });
            throw already;
        }
        if (data.session) return 'session';
        return 'confirm_email';
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

    signOut: async () => {
        const prevId = get().user?.id;
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        clearOAuthTimeout();
        dropProfilePlanCache(prevId);
        set({ user: null, oauthPending: false, oauthError: null });
    },
}));
