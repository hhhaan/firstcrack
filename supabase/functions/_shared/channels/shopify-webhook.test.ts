import { describe, expect, it } from 'vitest';
import { classifyShopifyTopic } from './shopify-webhook.ts';

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
