import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

interface AuthState {
    user: User | null;
    loading: boolean;
}

interface AuthActions {
    /** App 최상단에서 한 번 호출. 반환값은 cleanup 함수. */
    init: () => () => void;
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
    user: null,
    loading: true,

    init: () => {
        // Supabase v2: onAuthStateChange가 subscribe 시점에 INITIAL_SESSION으로 즉시 발화
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
            const next = session?.user ?? null;
            // user.id 동등성 가드 — 동일 세션 이벤트 시 불필요한 리렌더 방지
            if (get().user?.id === next?.id && !get().loading) return;
            set({ user: next, loading: false });
        });

        return () => subscription.unsubscribe();
    },
}));
