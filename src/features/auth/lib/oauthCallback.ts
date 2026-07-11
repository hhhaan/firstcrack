import { logger } from '@shared/lib/logger';
import { supabase } from '@shared/lib/supabase';
import type { AuthErrorCode } from '@shared/store/auth';

const isOAuthCallbackUrl = (url: string) => url.includes('auth/callback');

export type OAuthCallbackResult = { ok: true } | { ok: false; code: AuthErrorCode; skip?: boolean };

export const exchangeOAuthCallbackUrl = async (rawUrl: string, _source = 'unknown'): Promise<OAuthCallbackResult> => {
    if (!isOAuthCallbackUrl(rawUrl)) {
        return { ok: false, code: 'oauth_failed', skip: true };
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, code: 'oauth_failed' };
    }

    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const providerError = parsed.searchParams.get('error') ?? hash.get('error');
    if (providerError) {
        // User denied / provider error — unlock UI, no Sentry (expected)
        return { ok: false, code: 'oauth_failed' };
    }

    const code = parsed.searchParams.get('code');
    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
            logger.capture(error, { context: 'auth.oauth_callback', flow: 'exchange_code' });
            return { ok: false, code: 'oauth_failed' };
        }
        return { ok: true };
    }

    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
        if (error) {
            logger.capture(error, { context: 'auth.oauth_callback', flow: 'set_session' });
            return { ok: false, code: 'oauth_failed' };
        }
        return { ok: true };
    }

    return { ok: false, code: 'oauth_failed' };
};
