import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

type Plan = 'free' | 'pro' | 'team';

interface AuthState {
    user: User | null;
    plan: Plan;
    loading: boolean;
}

interface AuthActions {
    /** App 최상단에서 한 번 호출. 반환값은 cleanup 함수. */
    init: () => () => void;
    /** Email + Password 로그인. 실패 시 에러 throw. */
    signInWithEmail: (email: string, password: string) => Promise<void>;
    /** 로그아웃 */
    signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
    user: null,
    plan: 'free',
    loading: true,

    init: () => {
        // 5초 안에 auth 응답 없으면 강제로 loading 해제 (토큰 refresh hang 방어)
        const timeout = setTimeout(() => {
            if (get().loading) set({ user: null, plan: 'free', loading: false });
        }, 5000);

        // onAuthStateChange는 동기 콜백이어야 함 — async 사용 금지
        // Supabase v2: subscribe 시점에 INITIAL_SESSION으로 즉시 발화
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_, session) => {
            clearTimeout(timeout);

            const next = session?.user ?? null;
            if (get().user?.id === next?.id && !get().loading) return;

            // loading은 즉시 해제 — plan은 백그라운드에서 업데이트
            set({ user: next, plan: 'free', loading: false });

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
            subscription.unsubscribe();
        };
    },

    signInWithEmail: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    },

    signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        set({ user: null, plan: 'free' });
    },
}));

/** 현재 유저가 Pro 이상인지 반환 (pro / team 모두 true) */
export const selectIsPro = (s: AuthState & AuthActions) => s.plan !== 'free';
