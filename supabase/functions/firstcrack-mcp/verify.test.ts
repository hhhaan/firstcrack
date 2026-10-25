import { createClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memberId, otherOwnerId, validClaims } from './test-fixtures.ts';
import { verifySupabaseToken } from './verify.ts';

let key: CryptoKeyPair;
let jwk: JsonWebKey;
const fetchAuth = vi.fn<typeof fetch>();
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function sign(claims = validClaims(), signingKey = key.privateKey) {
    const payload = `${encode({ alg: 'ES256', typ: 'JWT', kid: 'test-key' })}.${encode(claims)}`;
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        signingKey,
        new TextEncoder().encode(payload),
    );
    return `${payload}.${Buffer.from(signature).toString('base64url')}`;
}
const client = () =>
    createClient('https://project.example', 'test-public-key', {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: crypto.randomUUID(),
        },
        global: { fetch: fetchAuth },
    });

beforeAll(async () => {
    key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    jwk = await crypto.subtle.exportKey('jwk', key.publicKey);
});
beforeEach(() => {
    vi.clearAllMocks();
    fetchAuth.mockImplementation(async (input) => {
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
        if (path.endsWith('/.well-known/jwks.json'))
            return Response.json({ keys: [{ ...jwk, kid: 'test-key', alg: 'ES256', use: 'sig' }] });
        if (path === '/auth/v1/user') return Response.json({ id: memberId, is_anonymous: false });
        throw new Error('Unexpected test network destination');
    });
});

describe('Supabase SDK token verification with local signing keys and stubbed Auth transport', () => {
    it('verifies a correctly signed JWT and checks the Auth identity', async () => {
        const claims = validClaims();
        expect(await verifySupabaseToken(client().auth, await sign(claims))).toMatchObject(claims);
        expect(fetchAuth.mock.calls.some(([input]) => String(input).endsWith('/user'))).toBe(true);
    });

    it('rejects a different signing key and a modified payload', async () => {
        const otherKey = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
            'sign',
            'verify',
        ]);
        expect(await verifySupabaseToken(client().auth, await sign(validClaims(), otherKey.privateKey))).toBeNull();
        const token = await sign();
        const parts = token.split('.');
        parts[1] = encode({ ...validClaims(), sub: otherOwnerId });
        expect(await verifySupabaseToken(client().auth, parts.join('.'))).toBeNull();
    });

    it('rejects an expired JWT', async () => {
        expect(await verifySupabaseToken(client().auth, await sign({ ...validClaims(), exp: 1 }))).toBeNull();
    });

    it('rejects an unavailable or mismatched Auth identity', async () => {
        const token = await sign();
        fetchAuth.mockResolvedValue(Response.json({ message: 'User not available' }, { status: 401 }));
        expect(await verifySupabaseToken(client().auth, token)).toBeNull();
        fetchAuth.mockImplementation(async () => Response.json({ id: otherOwnerId, is_anonymous: false }));
        expect(await verifySupabaseToken(client().auth, token)).toBeNull();
    });
});
