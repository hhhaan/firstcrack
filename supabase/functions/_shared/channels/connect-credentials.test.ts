import { describe, expect, it } from 'vitest';
import { pickConnectCredentials } from './connect-credentials.ts';

describe('pickConnectCredentials', () => {
    it('keeps only allow-listed shopify keys and drops injected adapter-managed keys', () => {
        expect(
            pickConnectCredentials('shopify', {
                shop: 'mystore.myshopify.com',
                access_token: 'shpat_x',
                webhook_secret: 'whsec',
                refresh_token: 'injected',
                token_expires_at: 1,
                mall_id: 'victim',
            }),
        ).toEqual({
            shop: 'mystore.myshopify.com',
            access_token: 'shpat_x',
            webhook_secret: 'whsec',
        });
    });

    it('trims strings and drops empty / nullish values', () => {
        expect(
            pickConnectCredentials('naver', {
                client_id: '  id  ',
                client_secret: '   ',
                shop: 'ignored',
            }),
        ).toEqual({ client_id: 'id' });
    });

    it('returns nothing for cafe24 (OAuth-only)', () => {
        expect(pickConnectCredentials('cafe24', { access_token: 'x', mall_id: 'm' })).toEqual({});
    });
});
