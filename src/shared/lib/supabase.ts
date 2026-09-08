import type { Database } from '@shared/types/database.types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const MISSING_SUPABASE_ENV =
    'Supabase is not configured. Rebuild with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.';

type SupabaseEnv = {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
};

const AUTH_OPTIONS = {
    auth: {
        flowType: 'pkce' as const,
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
    },
};

const failClosedClient = (): SupabaseClient<Database> =>
    new Proxy({} as SupabaseClient<Database>, {
        get() {
            throw new Error(MISSING_SUPABASE_ENV);
        },
    });

export function createBrowserSupabase(env: SupabaseEnv = import.meta.env) {
    const url = env.VITE_SUPABASE_URL?.trim() ?? '';
    const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
    if (!url || !key) {
        return { configured: false as const, client: failClosedClient() };
    }
    return {
        configured: true as const,
        client: createClient<Database>(url, key, AUTH_OPTIONS),
    };
}

const created = createBrowserSupabase();
export const isSupabaseConfigured = created.configured;
export const supabase = created.client;
