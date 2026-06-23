import { supabase } from '@shared/lib/supabase';

const isOAuthCallbackUrl = (url: string) => url.includes('auth/callback');

export const exchangeOAuthCallbackUrl = async (
    rawUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!isOAuthCallbackUrl(rawUrl)) {
        return { ok: false, error: 'Not an OAuth callback URL' };
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, error: 'Invalid callback URL' };
    }

    const code = parsed.searchParams.get('code');
    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) return { ok: false, error: error.message };
        return { ok: true };
    }

    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
    }

    return { ok: false, error: 'No auth code or tokens in callback URL' };
};
