import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeCodeForSession = vi.fn();
const setSession = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
    supabase: {
        auth: {
            exchangeCodeForSession: (...args: unknown[]) => exchangeCodeForSession(...args),
            setSession: (...args: unknown[]) => setSession(...args),
        },
    },
}));

vi.mock('@shared/lib/logger', () => ({
    logger: { capture: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn(), info: vi.fn() },
}));

import { logger } from '@shared/lib/logger';
import { exchangeOAuthCallbackUrl } from './oauthCallback';

describe('exchangeOAuthCallbackUrl', () => {
    beforeEach(() => {
        exchangeCodeForSession.mockReset();
        setSession.mockReset();
        vi.mocked(logger.capture).mockClear();
    });

    it('skips non-callback URLs', async () => {
        const result = await exchangeOAuthCallbackUrl('firstcrack://other');
        expect(result).toEqual({ ok: false, code: 'oauth_failed', skip: true });
    });

    it('maps provider error without Sentry', async () => {
        const result = await exchangeOAuthCallbackUrl(
            'firstcrack://auth/callback?error=access_denied&error_description=user_denied',
        );
        expect(result).toEqual({ ok: false, code: 'oauth_failed' });
        expect(logger.capture).not.toHaveBeenCalled();
        expect(exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it('exchanges code on success', async () => {
        exchangeCodeForSession.mockResolvedValue({ error: null });
        const result = await exchangeOAuthCallbackUrl('firstcrack://auth/callback?code=abc');
        expect(result).toEqual({ ok: true });
        expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    });

    it('captures exchange failure', async () => {
        const err = new Error('exchange failed');
        exchangeCodeForSession.mockResolvedValue({ error: err });
        const result = await exchangeOAuthCallbackUrl('firstcrack://auth/callback?code=abc');
        expect(result).toEqual({ ok: false, code: 'oauth_failed' });
        expect(logger.capture).toHaveBeenCalled();
    });
});
