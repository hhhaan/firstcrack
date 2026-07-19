import type { User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

/** Stable auth UI error codes — no raw Supabase strings in UI. */
export type AuthErrorCode = 'invalid_credentials' | 'network' | 'oauth_failed' | 'generic';

/** SSOT states + legacy values still present mid-rollout. 'free' doubles as the loading placeholder (no features, writable). */
export type Plan = 'trial' | 'read_only' | 'pro' | 'pro_plus' | 'enterprise' | 'free' | 'team';

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
    plan: Plan;
    loading: boolean;
    oauthPending: boolean;
    oauthError: AuthErrorCode | null;
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
    /** 로그아웃 */
    signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
    user: null,
    plan: 'free',
    loading: true,
    oauthPending: false,
    oauthError: null,

    init: () => {
        // 5초 안에 auth 응답 없으면 강제로 loading 해제 (토큰 refresh hang 방어)
        const timeout = setTimeout(() => {
            if (get().loading) set({ user: null, plan: 'free', loading: false });
        }, 5000);

        // onAuthStateChange hang 시 getSession으로 폴백
        void supabase.auth.getSession().then(({ data: { session } }) => {
            if (!get().loading) return;
            clearTimeout(timeout);
            const next = session?.user ?? null;
            set({
                user: next,
                plan: 'free',
                loading: false,
                oauthPending: false,
                oauthError: null,
            });
            if (next) {
                void (async () => {
                    try {
                        const { data } = await supabase.from('profiles').select('plan').eq('id', next.id).single();
                        if (data?.plan) set({ plan: data.plan as Plan });
                    } catch (e) {
                        logger.capture(e, { context: 'auth plan fetch' });
                    }
                })();
            }
        });

        // onAuthStateChange는 동기 콜백이어야 함 — async 사용 금지
        // Supabase v2: subscribe 시점에 INITIAL_SESSION으로 즉시 발화
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_, session) => {
            clearTimeout(timeout);

            const next = session?.user ?? null;
            if (get().user?.id === next?.id && !get().loading && !get().oauthPending) return;

            clearOAuthTimeout();
            set({
                user: next,
                plan: 'free',
                loading: false,
                oauthPending: false,
                oauthError: null,
            });

            if (next) {
                void (async () => {
                    try {
                        const { data } = await supabase.from('profiles').select('plan').eq('id', next.id).single();
                        if (data?.plan) set({ plan: data.plan as Plan });
                    } catch (e) {
                        logger.capture(e, { context: 'auth plan fetch' });
                    }
                })();
            }
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
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        clearOAuthTimeout();
        set({ user: null, plan: 'free', oauthPending: false, oauthError: null });
    },
}));
