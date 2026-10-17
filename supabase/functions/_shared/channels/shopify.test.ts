import { afterEach, describe, expect, it, vi } from 'vitest';
import { shopifyAdapter } from './shopify.ts';

afterEach(() => vi.unstubAllGlobals());

describe('Shopify Admin endpoint', () => {
    it.each(['demo', 'demo.myshopify.com', 'https://Demo.myshopify.com/'])('accepts %s', async (shop) => {
        const fetch = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: { shop: { name: 'Demo', myshopifyDomain: 'demo.myshopify.com' } },
                }),
            ),
        );
        vi.stubGlobal('fetch', fetch);
        await shopifyAdapter.testConnection({ shop, access_token: 'token' });
        expect(fetch).toHaveBeenCalledWith(
            expect.stringMatching(/^https:\/\/demo\.myshopify\.com\/admin\//),
            expect.objectContaining({ redirect: 'manual' }),
        );
    });

    it.each([
        'attacker.example',
        'demo.myshopify.com.attacker.example',
        '127.0.0.1',
        'demo.myshopify.com:443',
        'demo.myshopify.com@attacker.example',
        'demo.myshopify.com/path',
        'demo.myshopify.com?x=1',
        '-demo.myshopify.com',
    ])('rejects %s before sending credentials', async (shop) => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(shopifyAdapter.testConnection({ shop, access_token: 'token' })).rejects.toThrow('myshopify.com');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects redirects without forwarding the Admin token', async () => {
        const fetch = vi.fn().mockResolvedValue(
            new Response(null, {
                status: 302,
                headers: { Location: 'https://attacker.example' },
            }),
        );
        vi.stubGlobal('fetch', fetch);
        await expect(shopifyAdapter.testConnection({ shop: 'demo', access_token: 'token' })).rejects.toThrow('302');
        expect(fetch).toHaveBeenCalledOnce();
    });
});
