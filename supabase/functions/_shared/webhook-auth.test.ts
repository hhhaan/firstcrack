import { describe, expect, it } from 'vitest';
import { verifyPolarSignature, verifySharedSecret, verifyShopifyHmac } from './webhook-auth';

// 알려진 HMAC-SHA256("secret", "body")
const HEX = 'dc46983557fea127b43af721467eb9b3fde2338fe3e14f51952aa8478c13d355';
const B64 = '3EaYNVf+oSe0OvchRn65s/3iM4/j4U9RlSqoR4wT01U=';

describe('verifyShopifyHmac (fail-closed)', () => {
    it('secret 없음 → false', async () => {
        expect(await verifyShopifyHmac(undefined, 'body', B64)).toBe(false);
        expect(await verifyShopifyHmac('', 'body', B64)).toBe(false);
    });
    it('header 없음 → false', async () => {
        expect(await verifyShopifyHmac('secret', 'body', null)).toBe(false);
    });
    it('불일치 → false / 일치 → true', async () => {
        expect(await verifyShopifyHmac('secret', 'body', 'wrong')).toBe(false);
        expect(await verifyShopifyHmac('secret', 'body', B64)).toBe(true);
    });
});

describe('verifyPolarSignature (fail-closed)', () => {
    it('secret/signature 없음 → false', async () => {
        expect(await verifyPolarSignature(undefined, 'body', HEX)).toBe(false);
        expect(await verifyPolarSignature('secret', 'body', null)).toBe(false);
    });
    it('일치 → true', async () => {
        expect(await verifyPolarSignature('secret', 'body', HEX)).toBe(true);
    });
});

describe('verifySharedSecret (fail-closed)', () => {
    it('expected 미설정 → false (env 없이 열리지 않는다)', () => {
        expect(verifySharedSecret(undefined, 'x')).toBe(false);
        expect(verifySharedSecret('', 'x')).toBe(false);
    });
    it('provided 없음/불일치 → false, 일치 → true', () => {
        expect(verifySharedSecret('s', null)).toBe(false);
        expect(verifySharedSecret('s', 'wrong')).toBe(false);
        expect(verifySharedSecret('s', 's')).toBe(true);
    });
});
