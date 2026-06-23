import type { User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

type Plan = 'free' | 'pro' | 'team';

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
    oauthError: string | null;
}

interface AuthActions {
    /** App 최상단에서 한 번 호출. 반환값은 cleanup 함수. */
    init: () => () => void;
    /** Email + Password 로그인. 실패 시 에러 throw. */
    signInWithEmail: (email: string, password: string) => Promise<void>;
    /** Google OAuth 시작 — 브라우저 리다이렉트 대기 상태로 전환 */
    startOAuth: () => void;
    /** OAuth 실패/타임아웃 시 대기 상태 해제 */
    cancelOAuth: (error?: string) => void;
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
                        console.warn('[auth] plan fetch failed:', e);
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
                        console.warn('[auth] plan fetch failed:', e);
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
                set({
                    oauthPending: false,
                    oauthError: 'Sign-in timed out. Please try again.',
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

/** 현재 유저가 Pro 이상인지 반환 (pro / team 모두 true) */
export const selectIsPro = (s: AuthState & AuthActions) => s.plan !== 'free';
