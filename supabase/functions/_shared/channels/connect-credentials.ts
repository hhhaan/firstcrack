/**
 * Allow-list of credential keys a client may submit to `channel-connect`.
 * Pure TS — no Deno globals.
 *
 * Everything the client sends lands in `sales_channel_secrets` (service role).
 * Without a filter a caller could inject/overwrite adapter-managed keys
 * (`access_token`, `refresh_token`, `token_expires_at`, `mall_id`, …).
 * Apply this to the *raw request body only* — never to the merged object that
 * already contains tokens minted by `adapter.refreshAuth`.
 */

import type { ChannelSecrets, Platform } from './types.ts';

const ALLOWED_KEYS: Record<Platform, readonly string[]> = {
    naver: ['client_id', 'client_secret'],
    // webhook_secret: Shopify webhook signing secret, used by order-webhook HMAC verify.
    shopify: ['shop', 'access_token', 'webhook_secret'],
    // cafe24 connects via OAuth only (cafe24-oauth-start/callback) — no client-supplied creds.
    cafe24: [],
    // App access/secret keys live in function env — never accept them from the client.
    toss_place: ['merchant_id'],
};

export function pickConnectCredentials(platform: Platform, raw: ChannelSecrets): ChannelSecrets {
    const allowed = ALLOWED_KEYS[platform] ?? [];
    const picked: ChannelSecrets = {};
    for (const key of allowed) {
        const value = raw[key];
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed) picked[key] = trimmed;
            continue;
        }
        picked[key] = value;
    }
    return picked;
}
