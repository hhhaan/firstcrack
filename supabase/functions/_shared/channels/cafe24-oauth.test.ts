import { afterEach, describe, expect, it, vi } from 'vitest';
import { signCafe24OAuthState, verifyCafe24OAuthState } from './cafe24-oauth.ts';

afterEach(() => vi.unstubAllGlobals());

describe('Cafe24 OAuth state', () => {
    it('accepts a signed state and rejects a changed signature or extra segment', async () => {
        vi.stubGlobal('Deno', { env: { get: () => 'state-secret' } });
        const state = { userId: 'owner', mallId: 'demo', nonce: 'nonce', exp: Date.now() + 600_000 };
        const signed = await signCafe24OAuthState(state);
        await expect(verifyCafe24OAuthState(signed)).resolves.toMatchObject(state);
        const [payload, signature] = signed.split('.');
        const changed = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
        await expect(verifyCafe24OAuthState(`${payload}.${changed}`)).rejects.toThrow('signature');
        await expect(verifyCafe24OAuthState(`${signed}.extra`)).rejects.toThrow('invalid state');
    });

    it('rejects expired state and an unconfigured secret', async () => {
        vi.stubGlobal('Deno', { env: { get: () => 'state-secret' } });
        const signed = await signCafe24OAuthState({ userId: 'owner', mallId: 'demo', nonce: 'n', exp: Date.now() - 1 });
        await expect(verifyCafe24OAuthState(signed)).rejects.toThrow('expired');
        vi.stubGlobal('Deno', { env: { get: () => undefined } });
        await expect(verifyCafe24OAuthState(signed)).rejects.toThrow('secret not configured');
    });
});
