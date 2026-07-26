/**
 * Outbound dispatch state machine + platform payload builders.
 * Pure TS — no Deno / npm.
 */

import type { MarkShippedRequest, MarkShippedResult } from './types.ts';

export type DispatchStatus = 'pending' | 'sent' | 'confirmed' | 'failed';
export type DispatchEvent =
    | 'api_ok'
    | 'api_already_shipped'
    | 'api_err'
    | 'inbound_shipped'
    | 'retry';

const TRANSITIONS: Partial<Record<DispatchStatus, Partial<Record<DispatchEvent, DispatchStatus>>>> = {
    pending: {
        api_ok: 'sent',
        api_already_shipped: 'sent',
        api_err: 'failed',
    },
    sent: {
        inbound_shipped: 'confirmed',
        api_ok: 'sent',
        api_already_shipped: 'sent',
    },
    failed: {
        retry: 'pending',
    },
    confirmed: {},
};

export function nextDispatchStatus(current: DispatchStatus, event: DispatchEvent): DispatchStatus {
    if (current === 'confirmed') return 'confirmed';
    return TRANSITIONS[current]?.[event] ?? current;
}

export function validateTrackingNumber(raw: string): string {
    const t = raw.trim();
    if (!t || /\s/.test(t)) {
        throw new Error('invalid tracking number');
    }
    return t;
}

export function buildNaverDispatchPayload(req: MarkShippedRequest): {
    dispatchProductOrders: Array<{
        productOrderId: string;
        deliveryMethod: 'DELIVERY';
        deliveryCompanyCode: string;
        trackingNumber: string;
        dispatchDate: string;
    }>;
} {
    const dispatchDate = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    return {
        dispatchProductOrders: req.lines.map((l) => ({
            productOrderId: l.platformLineId,
            deliveryMethod: 'DELIVERY' as const,
            deliveryCompanyCode: req.carrierCode,
            trackingNumber: req.trackingNumber,
            dispatchDate,
        })),
    };
}

/**
 * Official dispatch response: `data` is an OBJECT, and a single 200 can carry successes and
 * failures at the same time (partial dispatch).
 */
export interface NaverDispatchResponse {
    data?: { successProductOrderIds?: unknown; failProductOrderInfos?: unknown };
    code?: string;
    message?: string;
}

/**
 * Per-line outcome of a 200 dispatch response.
 *
 * Only membership in `successProductOrderIds` is trusted. The official docs defer the shape of
 * `failProductOrderInfos` to the OAS, so matching on failure codes would be guesswork — anything
 * not explicitly confirmed counts as not dispatched.
 *
 * Reading this fail-open is what deducts stock for orders the platform refused: `ok` is what makes
 * order-dispatch call `fulfill_order`.
 */
export function readNaverDispatchResult(
    json: NaverDispatchResponse,
    lines: { platformLineId: string }[],
): MarkShippedResult {
    const raw = json.data?.successProductOrderIds;
    const successIds = new Set((Array.isArray(raw) ? raw : []).map(String));

    const lineResults = lines.map((l) => {
        const ok = successIds.has(l.platformLineId);
        return {
            platformLineId: l.platformLineId,
            ok,
            error: ok ? undefined : 'not listed in successProductOrderIds',
        };
    });
    const failed = lineResults.filter((r) => !r.ok);

    return {
        ok: failed.length === 0,
        // Indistinguishable from any other failure without failProductOrderInfos — never claimed.
        alreadyShipped: false,
        lineResults,
        error: failed.length
            ? `naver dispatch: ${failed.length}/${lineResults.length} product orders not confirmed (${failed
                  .map((r) => r.platformLineId)
                  .join(', ')})`
            : undefined,
    };
}

export function buildCafe24ShipmentPayload(req: MarkShippedRequest): {
    request: {
        order_id: string;
        tracking_no: string;
        shipping_company_code: string;
        order_item_code: string[];
        status: 'shipping';
    };
} {
    return {
        request: {
            order_id: req.platformOrderId,
            tracking_no: req.trackingNumber,
            shipping_company_code: req.carrierCode,
            order_item_code: req.lines.map((l) => l.platformLineId),
            status: 'shipping',
        },
    };
}

export function buildShopifyFulfillmentInput(
    req: MarkShippedRequest,
    fulfillmentOrderIds: string[],
): {
    lineItemsByFulfillmentOrder: Array<{ fulfillmentOrderId: string }>;
    trackingInfo: { company: string; number: string };
    notifyCustomer: boolean;
} {
    return {
        lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((id) => ({
            fulfillmentOrderId: id,
        })),
        trackingInfo: {
            company: req.carrierCode,
            number: req.trackingNumber,
        },
        notifyCustomer: true,
    };
}
