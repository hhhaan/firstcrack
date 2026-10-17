/**
 * Naver Commerce API (Smart Store) — official docs only.
 *
 * Auth:
 *   https://apicenter.commerce.naver.com/docs/auth
 *   https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth
 *   Token URL: https://api.commerce.naver.com/external/v1/oauth2/token
 *   Signature: Base64(bcrypt.hashpw(clientId_timestamp, clientSecret))
 *   Body (form): client_id, timestamp, client_secret_sign, grant_type=client_credentials, type=SELF
 *   Token TTL: 3h (10800s); re-issue when <30m remaining
 *
 * Orders:
 *   GET  /v1/pay-order/seller/product-orders/last-changed-statuses
 *     https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-last-changed-status-pay-order-seller
 *     Window max 24h if lastChangedTo omitted; page via more.moreFrom + more.moreSequence; max 300/page
 *   POST /v1/pay-order/seller/product-orders/query
 *     https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-product-orders-pay-order-seller
 *     Body: productOrderIds[] max 300
 *
 * Schemas:
 *   https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/변경-상품-주문-정보-구조체
 *   https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/상품-주문-정보-구조체
 */

// bcryptjs 2.x is CommonJS: it has no named ESM exports, so `import { hash }` throws
// SyntaxError while the module is evaluated — which the edge runtime reports as BOOT_ERROR
// for every function importing this file. Type-checking does not catch it (the .d.ts
// declares the named export); only running it does. Default import is the working form.
import bcrypt from 'npm:bcryptjs@2.4.3';
import {
    buildNaverDispatchPayload,
    type NaverDispatchResponse,
    readNaverDispatchResult,
} from './dispatch.ts';
import { getLastChanged, NAVER_API_BASE, naverRequest, okStatus, toNaverDateTime } from './naver-http.ts';
import { pollNaverOrders } from './naver-poll.ts';
import type {
    ChannelAdapter,
    ChannelSecrets,
    FetchOrdersResult,
    MarkShippedRequest,
    MarkShippedResult,
    PlatformListing,
    PollCursor,
    SecretsRotationSink,
    TestConnectionResult,
} from './types.ts';

export interface NaverSecrets extends ChannelSecrets {
    client_id: string;
    client_secret: string;
    access_token?: string;
    token_expires_at?: number;
}

function requireNaver(secrets: ChannelSecrets): NaverSecrets {
    const client_id = String(secrets.client_id ?? '').trim();
    const client_secret = String(secrets.client_secret ?? '').trim();
    if (!client_id || !client_secret) throw new Error('naver: client_id and client_secret required');
    return {
        ...secrets,
        client_id,
        client_secret,
        access_token: secrets.access_token ? String(secrets.access_token) : undefined,
        token_expires_at: secrets.token_expires_at ? Number(secrets.token_expires_at) : undefined,
    };
}

/** Official Node sample: bcrypt.hashSync(password, clientSecret) then Buffer utf-8 → base64 */
export async function buildNaverSignature(clientId: string, clientSecret: string, timestampMs: number): Promise<string> {
    const password = `${clientId}_${timestampMs}`;
    const hashed = await bcrypt.hash(password, clientSecret);
    // hashed is ASCII bcrypt string; standard base64 of UTF-8 bytes (matches official Node/Python samples)
    return btoa(hashed);
}

export async function exchangeNaverToken(clientId: string, clientSecret: string): Promise<{
    access_token: string;
    expires_in: number;
}> {
    const timestamp = Date.now();
    const client_secret_sign = await buildNaverSignature(clientId, clientSecret, timestamp);
    const body = new URLSearchParams({
        client_id: clientId,
        timestamp: String(timestamp),
        client_secret_sign,
        grant_type: 'client_credentials',
        type: 'SELF',
    });

    // Safe to retry: `client_credentials` is stateless here — a re-issue mints an additional token
    // and revokes nothing, unlike Cafe24's refresh_token grant.
    const res = await naverRequest(`${NAVER_API_BASE}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!okStatus(res)) {
        throw new Error(`naver token ${res.status}: ${res.body.slice(0, 300)}`);
    }
    const json = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('naver token: missing access_token');
    return { access_token: json.access_token, expires_in: json.expires_in ?? 10800 };
}

async function withToken(secrets: NaverSecrets): Promise<{ token: string; refreshed: NaverSecrets | null }> {
    // Official: re-issue when remaining < 30 minutes
    const reissueSkewMs = 30 * 60 * 1000;
    if (secrets.access_token && secrets.token_expires_at && secrets.token_expires_at - reissueSkewMs > Date.now()) {
        return { token: secrets.access_token, refreshed: null };
    }
    const { access_token, expires_in } = await exchangeNaverToken(secrets.client_id, secrets.client_secret);
    const next: NaverSecrets = {
        ...secrets,
        access_token,
        token_expires_at: Date.now() + expires_in * 1000,
    };
    return { token: access_token, refreshed: next };
}

/** Mint/reuse an access token for one call and persist the re-issue before it is used. */
async function authorizedToken(secrets: ChannelSecrets, onRotate: SecretsRotationSink): Promise<string> {
    const { token, refreshed } = await withToken(requireNaver(secrets));
    if (refreshed) await onRotate(refreshed);
    return token;
}

export const naverAdapter: ChannelAdapter = {
    platform: 'naver',
    capabilities: { webhooks: false, outboundDispatch: true },

    async testConnection(secrets): Promise<TestConnectionResult> {
        const s = requireNaver(secrets);
        const { token } = await withToken(s);
        // Minimal authenticated call: last-changed 1h window (official endpoint)
        await getLastChanged(token, toNaverDateTime(new Date(Date.now() - 60 * 60 * 1000)));
        return {
            shopIdentifier: s.client_id,
            displayName: 'Naver Smart Store',
        };
    },

    async refreshAuth(secrets): Promise<ChannelSecrets | null> {
        const { refreshed } = await withToken(requireNaver(secrets));
        return refreshed;
    },

    async fetchOrdersSince(secrets, cursor, onRotate): Promise<FetchOrdersResult> {
        const token = await authorizedToken(secrets, onRotate);
        return pollNaverOrders(token, cursor);
    },

    async listProducts(): Promise<PlatformListing[]> {
        // Product catalog APIs are under a separate product API group; map via sellerProductCode on orders first.
        // Keep empty until product-search endpoint is wired from product docs.
        return [];
    },

    async markShipped(secrets, req: MarkShippedRequest, onRotate): Promise<MarkShippedResult> {
        const token = await authorizedToken(secrets, onRotate);

        const body = buildNaverDispatchPayload(req);
        // Retries here are 429 / 502-504 only: the gateway rejected the call, so nothing was
        // dispatched. A plain 500 is never replayed — that one could have shipped already.
        const res = await naverRequest(`${NAVER_API_BASE}/v1/pay-order/seller/product-orders/dispatch`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(body),
        });
        const text = res.body;
        let json: NaverDispatchResponse = {};
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            // keep empty
        }

        if (!okStatus(res)) {
            const msg = (json.message ?? text).slice(0, 500);
            const already =
                /already|already.?dispatched|ALREADY|DISPATCHED/i.test(msg) ||
                json.code === 'ALREADY_DISPATCHED';
            if (already) {
                return { ok: true, alreadyShipped: true, error: msg };
            }
            return { ok: false, alreadyShipped: false, error: `naver dispatch ${res.status}: ${msg}` };
        }

        return readNaverDispatchResult(json, req.lines);
    },
};
