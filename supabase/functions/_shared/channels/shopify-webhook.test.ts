import { describe, expect, it } from 'vitest';
import { classifyShopifyTopic, shopifyWebhookPreconditions } from './shopify-webhook.ts';

describe('classifyShopifyTopic', () => {
    it('routes order topics', () => {
        expect(classifyShopifyTopic('orders/create')).toBe('order');
        expect(classifyShopifyTopic('ORDERS/Cancelled')).toBe('order');
    });

    it('routes app/uninstalled', () => {
        expect(classifyShopifyTopic('app/uninstalled')).toBe('uninstall');
    });

    it('fails closed on missing, GDPR, delete and unknown topics', () => {
        expect(classifyShopifyTopic(null)).toBe('ignore');
        expect(classifyShopifyTopic('')).toBe('ignore');
        expect(classifyShopifyTopic('orders/delete')).toBe('ignore');
        expect(classifyShopifyTopic('customers/redact')).toBe('ignore');
        expect(classifyShopifyTopic('shop/redact')).toBe('ignore');
        expect(classifyShopifyTopic('customers/data_request')).toBe('ignore');
        expect(classifyShopifyTopic('products/update')).toBe('ignore');
    });
});

describe('shopifyWebhookPreconditions (#306 shop enumeration)', () => {
    it('rejects a missing shop before any lookup', () => {
        expect(shopifyWebhookPreconditions('', 'sig')).toEqual({
            ok: false,
            status: 400,
            error: 'missing shop domain',
        });
    });

    it('rejects a missing HMAC before any unknown-shop ack', () => {
        expect(shopifyWebhookPreconditions('store.myshopify.com', null)).toEqual({
            ok: false,
            status: 401,
            error: 'Unauthorized',
        });
    });

    it('lets a shop+HMAC pair continue to signature verify', () => {
        expect(shopifyWebhookPreconditions('store.myshopify.com', 'sig')).toEqual({ ok: true });
    });
});
