import { describe, expect, it } from 'vitest';
import { privateKeyJwtError } from './client-auth.ts';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const clientId = 'https://chatgpt.com/oauth/client.json';
const audiences = ['https://identity.example/oauth/mcp', 'https://identity.example/oauth/mcp/token'];

async function signed(claims: Record<string, unknown>, kid = 'chatgpt-key') {
    const key = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const header = encode({ alg: 'RS256', kid, typ: 'JWT' });
    const payload = encode(claims);
    const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${header}.${payload}`))).toString('base64url');
    const jwk = await crypto.subtle.exportKey('jwk', key.publicKey);
    return { jwt: `${header}.${payload}.${signature}`, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

describe('ChatGPT private_key_jwt client authentication', () => {
    it('ignores a public PKCE client', async () => {
        expect(await privateKeyJwtError(new URLSearchParams('grant_type=authorization_code'), audiences)).toBeNull();
    });

    it('accepts a short-lived assertion signed by the advertised key', async () => {
        const now = 1_800_000_000_000;
        const { jwt, jwk } = await signed({ iss: clientId, sub: clientId, aud: audiences[1], exp: now / 1000 + 60 });
        const fetcher = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === clientId) return Response.json({ token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'https://chatgpt.com/oauth/jwks.json' });
            return Response.json({ keys: [jwk] });
        }) as typeof fetch;
        const params = new URLSearchParams({ client_id: clientId, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: jwt });
        expect(await privateKeyJwtError(params, audiences, fetcher, now)).toBeNull();
    });

    it('rejects a different key, audience, or long lifetime', async () => {
        const now = 1_800_000_000_000;
        const { jwt } = await signed({ iss: clientId, sub: clientId, aud: audiences[1], exp: now / 1000 + 60 });
        const other = await signed({ iss: clientId, sub: clientId, aud: 'https://attacker.example', exp: now / 1000 + 60 }, 'other');
        const long = await signed({ iss: clientId, sub: clientId, aud: audiences[0], exp: now / 1000 + 3600 });
        const fetcher = (async () => Response.json({ token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'https://chatgpt.com/oauth/jwks.json', keys: [other.jwk] })) as typeof fetch;
        const params = new URLSearchParams({ client_id: clientId, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: jwt });
        expect(await privateKeyJwtError(params, audiences, fetcher, now)).toBe('invalid_client');
        params.set('client_assertion', other.jwt);
        const matching = (async () => Response.json({ token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'https://chatgpt.com/oauth/jwks.json', keys: [other.jwk] })) as typeof fetch;
        expect(await privateKeyJwtError(params, audiences, matching, now)).toBe('invalid_client');
        params.set('client_assertion', long.jwt);
        const longKey = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('jwks.json')) return Response.json({ keys: [long.jwk] });
            return Response.json({ token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'https://chatgpt.com/oauth/jwks.json' });
        }) as typeof fetch;
        expect(await privateKeyJwtError(params, audiences, longKey, now)).toBe('invalid_client');
    });
});
