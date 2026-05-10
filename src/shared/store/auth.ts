import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

interface AuthState {
    user: User | null;
    loggedIn: boolean;
    loading: boolean;
}

interface AuthActions {
    /** App 최상단에서 한 번 호출. 반환값은 cleanup 함수. */
    init: () => () => void;
}

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
    user: null,
    loggedIn: false,
    loading: true,

    init: () => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            set({ user: session?.user ?? null, loggedIn: !!session, loading: false });
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
            set({ user: session?.user ?? null, loggedIn: !!session, loading: false });
        });

        return () => subscription.unsubscribe();
    },
}));
