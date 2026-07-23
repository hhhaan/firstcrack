/** Deterministic e2e identity — not a live account. */
export const E2E_USER = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'e2e@firstcrack.local',
} as const;

export const E2E_SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'https://e2e.supabase.local';
export const E2E_SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? 'e2e-anon-key';
export const E2E_PROJECT_REF = 'e2e';

/** Auth storage key used by supabase-js persistSession. */
export const authStorageKey = (projectRef = E2E_PROJECT_REF) => `sb-${projectRef}-auth-token`;
