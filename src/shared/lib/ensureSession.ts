import { supabase } from './supabase';

/**
 * Best-effort session revival before an important write.
 * getSession() already refreshes an expired access token; refreshSession() is the
 * second chance when the auto-refresh timer was missed (sleep / long background).
 * Returns false only when the session is truly dead (refresh token revoked).
 */
export async function ensureSession(): Promise<boolean> {
    try {
        const { data } = await supabase.auth.getSession();
        if (data.session) return true;
        const { data: refreshed } = await supabase.auth.refreshSession();
        return refreshed.session != null;
    } catch {
        return false;
    }
}
