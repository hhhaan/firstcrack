/**
 * Shopify webhook topic routing. Pure TS — no Deno globals.
 *
 * A valid HMAC only proves the request came from Shopify; it says nothing about
 * *what* was delivered. Without a topic check every signed payload (GDPR
 * requests, product updates, app lifecycle) is parsed as an order.
 * Fail closed: anything not explicitly listed is ignored.
 */

export type ShopifyTopicKind = 'order' | 'uninstall' | 'ignore';

/** Topics whose payload is a full Order object. */
const ORDER_TOPICS = new Set([
    'orders/create',
    'orders/updated',
    'orders/paid',
    'orders/partially_fulfilled',
    'orders/fulfilled',
    'orders/cancelled',
    'orders/edited',
]);

/**
 * `orders/delete` carries only `{ id }` and GDPR topics carry no order at all —
 * both must be acknowledged (200) without touching the order tables.
 */
export function classifyShopifyTopic(topic: string | null): ShopifyTopicKind {
    const normalized = (topic ?? '').trim().toLowerCase();
    if (!normalized) return 'ignore';
    if (normalized === 'app/uninstalled') return 'uninstall';
    if (ORDER_TOPICS.has(normalized)) return 'order';
    return 'ignore';
}

/**
 * Header checks that must run before any shop-existence ack. Returning 200 for an
 * unknown shop without an HMAC header lets anyone enumerate connected domains.
 */
export function shopifyWebhookPreconditions(
    shop: string,
    hmac: string | null,
): { ok: true } | { ok: false; status: 400 | 401; error: string } {
    if (!shop) return { ok: false, status: 400, error: 'missing shop domain' };
    if (!hmac) return { ok: false, status: 401, error: 'Unauthorized' };
    return { ok: true };
}
