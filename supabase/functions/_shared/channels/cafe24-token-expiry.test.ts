import { describe, expect, it } from 'vitest';
import { CAFE24_ACCESS_TOKEN_TTL_MS, tokenExpiresAtMs } from './cafe24-oauth.ts';

const NOW = Date.parse('2026-07-26T00:00:00.000Z');

describe('tokenExpiresAtMs (#121 refresh_token double rotation)', () => {
    it('uses expires_in when present', () => {
        expect(tokenExpiresAtMs({ access_token: 'a', expires_in: 3600 }, NOW)).toBe(NOW + 3_600_000);
    });

    it('never returns undefined — an unknown expiry disables the refresh skew guard', () => {
        expect(tokenExpiresAtMs({ access_token: 'a' }, NOW)).toBe(NOW + CAFE24_ACCESS_TOKEN_TTL_MS);
        expect(tokenExpiresAtMs({ access_token: 'a', expires_at: 'not-a-date' }, NOW)).toBe(
            NOW + CAFE24_ACCESS_TOKEN_TTL_MS,
        );
    });

    it('clamps an expires_at that parses far into the future down to the documented TTL', () => {
        // expires_at carries no timezone offset, so a mis-parse can land hours late and hand out
        // an access token the platform already rejected.
        expect(tokenExpiresAtMs({ access_token: 'a', expires_at: '2026-07-27T00:00:00.000' }, NOW)).toBe(
            NOW + CAFE24_ACCESS_TOKEN_TTL_MS,
        );
    });

    it('never returns a past timestamp', () => {
        expect(tokenExpiresAtMs({ access_token: 'a', expires_in: -60 }, NOW)).toBe(NOW);
    });

    it('keeps a plausible expires_at untouched', () => {
        const at = '2026-07-26T01:00:00.000Z';
        expect(tokenExpiresAtMs({ access_token: 'a', expires_at: at }, NOW)).toBe(Date.parse(at));
    });
});
