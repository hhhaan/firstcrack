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
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
    user: null,
    plan: 'free',
    loading: true,

    init: () => {
        // Supabase v2: onAuthStateChange가 subscribe 시점에 INITIAL_SESSION으로 즉시 발화
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_, session) => {
            const next = session?.user ?? null;
            // user.id 동등성 가드 — 동일 세션 이벤트 시 불필요한 리렌더 방지
            if (get().user?.id === next?.id && !get().loading) return;

            if (next) {
                try {
                    const { data } = await supabase
                        .from('profiles')
                        .select('plan')
                        .eq('id', next.id)
                        .single();
                    set({ user: next, plan: (data?.plan ?? 'free') as Plan, loading: false });
                } catch {
                    set({ user: next, plan: 'free', loading: false });
                }
            } else {
                set({ user: null, plan: 'free', loading: false });
            }
        });

        return () => subscription.unsubscribe();
    },
}));

/** 현재 유저가 Pro 이상인지 반환 (pro / team 모두 true) */
export const selectIsPro = (s: AuthState & AuthActions) => s.plan !== 'free';
