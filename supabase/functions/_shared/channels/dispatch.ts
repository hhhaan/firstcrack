/**
 * Outbound dispatch state machine + platform payload builders.
 * Pure TS — no Deno / npm.
 */

import type { MarkShippedRequest } from './types.ts';

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
