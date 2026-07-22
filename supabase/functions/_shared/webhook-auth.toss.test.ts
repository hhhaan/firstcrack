import { describe, expect, it } from 'vitest';
import { verifyTossPlaceSignature } from './webhook-auth.ts';

const te = new TextEncoder();

async function hmacHex(secret: string, payload: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
    ]);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(payload)));
    return Array.from(sig)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

describe('verifyTossPlaceSignature', () => {
    it('accepts valid v1= hex signature', async () => {
        const secret = 'whsec_test';
        const body = '{"eventType":"order.order.completed.v1"}';
        const ts = String(Math.floor(Date.now() / 1000));
        const hex = await hmacHex(secret, `${ts}.${body}`);
        await expect(verifyTossPlaceSignature(secret, body, `v1=${hex}`, ts)).resolves.toBe(true);
    });

    it('rejects bad signature and missing secret', async () => {
        const body = '{}';
        const ts = String(Math.floor(Date.now() / 1000));
        await expect(verifyTossPlaceSignature(undefined, body, 'v1=ab', ts)).resolves.toBe(false);
        await expect(verifyTossPlaceSignature('s', body, null, ts)).resolves.toBe(false);
        await expect(verifyTossPlaceSignature('s', body, 'v1=deadbeef', ts)).resolves.toBe(false);
    });
});
