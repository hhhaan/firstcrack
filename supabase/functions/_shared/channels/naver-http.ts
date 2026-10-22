/**
 * Naver Commerce HTTP helpers shared by naver.ts (auth) and naver-poll.ts (orders).
 * No bcrypt — safe for Vitest imports.
 */

import { type HttpAttempt, naverThrottle, readHttpAttempt, withRetry } from './rate-limit.ts';

export const NAVER_API_BASE = 'https://api.commerce.naver.com/external';

export async function naverRequest(url: URL | string, init?: RequestInit): Promise<HttpAttempt> {
    return withRetry(() => fetch(url, init).then(readHttpAttempt), naverThrottle, { label: 'naver' });
}

export function okStatus(attempt: HttpAttempt): boolean {
    return attempt.status >= 200 && attempt.status < 300;
}

/** Official date-time example: 2023-01-16T17:14:51.794+09:00 — ISO-8601 with offset is accepted. */
export function toNaverDateTime(d: Date): string {
    return d.toISOString().replace(/\.\d{3}Z$/, '.000+00:00');
}

export type LastChangedRow = {
    orderId?: string;
    productOrderId?: string;
    productOrderStatus?: string;
    claimStatus?: string;
    lastChangedDate?: string;
    paymentDate?: string;
};

type LastChangedResponse = {
    data?: {
        lastChangeStatuses?: LastChangedRow[];
        more?: { moreFrom?: string; moreSequence?: string | number };
    };
    lastChangeStatuses?: LastChangedRow[];
    more?: { moreFrom?: string; moreSequence?: string | number };
};

export class NaverHttpError extends Error {
    readonly status: number;
    readonly body: string;
    constructor(step: string, attempt: HttpAttempt) {
        super(`naver ${step} ${attempt.status}: ${attempt.body.slice(0, 300)}`);
        this.name = 'NaverHttpError';
        this.status = attempt.status;
        this.body = attempt.body;
    }
}

export async function getLastChanged(
    accessToken: string,
    lastChangedFrom: string,
    lastChangedTo?: string,
    moreSequence?: string,
): Promise<{ rows: LastChangedRow[]; moreFrom?: string; moreSequence?: string }> {
    const url = new URL(`${NAVER_API_BASE}/v1/pay-order/seller/product-orders/last-changed-statuses`);
    url.searchParams.set('lastChangedFrom', lastChangedFrom);
    if (lastChangedTo) url.searchParams.set('lastChangedTo', lastChangedTo);
    if (moreSequence) url.searchParams.set('moreSequence', moreSequence);

    const res = await naverRequest(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!okStatus(res)) {
        throw new NaverHttpError('last-changed', res);
    }
    const json = JSON.parse(res.body) as LastChangedResponse;
    const rows = json.data?.lastChangeStatuses ?? json.lastChangeStatuses ?? [];
    const more = json.data?.more ?? json.more;
    return {
        rows,
        moreFrom: more?.moreFrom,
        moreSequence: more?.moreSequence != null ? String(more.moreSequence) : undefined,
    };
}

export async function queryProductOrders(accessToken: string, productOrderIds: string[]): Promise<unknown[]> {
    if (!productOrderIds.length) return [];
    const res = await naverRequest(`${NAVER_API_BASE}/v1/pay-order/seller/product-orders/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ productOrderIds }),
    });
    if (!okStatus(res)) {
        throw new NaverHttpError('product-orders/query', res);
    }
    const json = JSON.parse(res.body) as { data?: unknown[] | { data?: unknown[] } };
    if (Array.isArray(json.data)) return json.data;
    if (json.data && typeof json.data === 'object' && Array.isArray((json.data as { data?: unknown[] }).data)) {
        return (json.data as { data: unknown[] }).data;
    }
    return [];
}
