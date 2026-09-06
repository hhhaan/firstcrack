/**
 * Platform status → canonical status.
 * Sources (fetched 2026-07-16):
 * - Naver productOrderStatus / claimStatus:
 *   https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/변경-상품-주문-정보-구조체
 * - Shopify displayFinancialStatus / displayFulfillmentStatus filters:
 *   https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
 * - Cafe24 paid / canceled / shipping_status / process_status:
 *   https://developers.cafe24.com/docs/en/api/admin/ (Orders property list)
 */
import type { CanonicalStatus } from './types.ts';

const RANK: Record<CanonicalStatus, number> = {
    pending: 0,
    paid: 1,
    preparing: 2,
    shipped: 3,
    delivered: 4,
    cancelled: 100,
    refunded: 100,
};

const TERMINAL = new Set<CanonicalStatus>(['cancelled', 'refunded']);

export function mergeStatus(current: CanonicalStatus, incoming: CanonicalStatus): CanonicalStatus {
    if (TERMINAL.has(incoming)) return incoming;
    if (TERMINAL.has(current)) return current;
    return RANK[incoming] > RANK[current] ? incoming : current;
}

/**
 * Naver productOrderStatus (+ optional claimStatus).
 * Official productOrderStatus codes:
 * PAYMENT_WAITING | PAYED | DELIVERING | DELIVERED | PURCHASE_DECIDED |
 * EXCHANGED | CANCELED | RETURNED | CANCELED_BY_NOPAYMENT
 *
 * claimStatus CANCEL_DONE / RETURN_DONE / ADMIN_CANCEL_DONE take precedence when present.
 */
export function naverToCanonical(productOrderStatus: string, claimStatus?: string | null): CanonicalStatus | null {
    const claim = (claimStatus ?? '').toUpperCase();
    if (
        claim === 'CANCEL_DONE' ||
        claim === 'ADMIN_CANCEL_DONE' ||
        claim === 'CANCELING' ||
        claim === 'ADMIN_CANCELING'
    ) {
        return 'cancelled';
    }
    if (claim === 'RETURN_DONE') return 'refunded';
    // In-progress claims: keep prior product status (caller merges); still map if only claim given
    if (claim === 'CANCEL_REQUEST' || claim === 'RETURN_REQUEST') {
        // surface as preparing-ish until done; prefer product status if available
    }

    switch ((productOrderStatus ?? '').toUpperCase()) {
        case 'PAYMENT_WAITING':
            return 'pending';
        case 'PAYED':
            return 'paid';
        case 'DELIVERING':
            return 'shipped';
        case 'DELIVERED':
            return 'delivered';
        case 'PURCHASE_DECIDED':
            return 'delivered';
        case 'CANCELED':
        case 'CANCELED_BY_NOPAYMENT':
            return 'cancelled';
        case 'RETURNED':
            return 'refunded';
        case 'EXCHANGED':
            // exchange completed — treat as active paid line replacement; keep paid
            return 'paid';
        default:
            return null;
    }
}

/**
 * Cafe24 Orders property list (official):
 * - paid: T Paid | F Unpaid | M Partially paid
 * - canceled: T Canceled | F Not | M Partial
 * - shipping_status: F Awaiting shipment | M In transit | T Delivered | W Hold | X Awaiting confirmation
 * - process_status: prepare | prepareproduct | hold | unhold
 */
export function cafe24ToCanonical(input: {
    paid?: string | null;
    canceled?: string | null;
    shippingStatus?: string | null;
    processStatus?: string | null;
    orderStatus?: string | null; // search code if present on some payloads
}): CanonicalStatus | null {
    const canceled = (input.canceled ?? '').toUpperCase();
    if (canceled === 'T') return 'cancelled';

    const ship = (input.shippingStatus ?? '').toUpperCase();
    if (ship === 'T') return 'delivered';
    if (ship === 'M') return 'shipped';
    if (ship === 'W' || ship === 'X') return 'preparing';

    const process = (input.processStatus ?? '').toLowerCase();
    if (process === 'prepare' || process === 'prepareproduct' || process === 'hold') {
        return 'preparing';
    }

    const paid = (input.paid ?? '').toUpperCase();
    if (paid === 'T' || paid === 'M') return 'paid';
    if (paid === 'F') return 'pending';

    // order_status search codes sometimes echoed on responses (N10 etc.) — best-effort only
    const os = (input.orderStatus ?? '').toUpperCase();
    if (os.startsWith('C') || os.includes('CANCEL')) return 'cancelled';
    if (os) return null;

    return null;
}

/**
 * Shopify Order.displayFinancialStatus + displayFulfillmentStatus
 * (+ cancelledAt handled by caller).
 *
 * Financial (display + filter): paid | pending | authorized | partially_paid |
 * partially_refunded | refunded | voided | expired
 *
 * Fulfillment — OrderDisplayFulfillmentStatus (GraphQL display enum):
 * FULFILLED | IN_PROGRESS | ON_HOLD | OPEN | PARTIALLY_FULFILLED |
 * PENDING_FULFILLMENT | REQUEST_DECLINED | RESTOCKED | SCHEDULED | UNFULFILLED
 * Plus search-filter synonyms still seen on some payloads: shipped | unshipped | partial
 */
export function shopifyToCanonical(
    financial: string | null | undefined,
    fulfillment: string | null | undefined,
    cancelledAt?: string | null,
): CanonicalStatus | null {
    if (cancelledAt) return 'cancelled';

    const fin = (financial ?? '').toLowerCase();
    const ful = (fulfillment ?? '').toLowerCase();

    if (fin === 'refunded' || fin === 'voided') return 'refunded';
    if (fin === 'partially_refunded' && (ful === 'restocked' || ful === 'fulfilled')) return 'refunded';

    // Fully shipped / fulfilled (display + filter synonym)
    if (ful === 'fulfilled' || ful === 'shipped') return 'shipped';

    // In-progress fulfillment (display enums + filter synonyms)
    if (
        ful === 'partial' ||
        ful === 'partially_fulfilled' ||
        ful === 'scheduled' ||
        ful === 'on_hold' ||
        ful === 'in_progress' ||
        ful === 'pending_fulfillment' ||
        ful === 'request_declined' ||
        ful === 'open'
    ) {
        return 'preparing';
    }

    // RESTOCKED alone is not terminal without refund — fall through to financial
    if (fin === 'pending' || fin === 'authorized' || fin === 'expired') return 'pending';
    if (fin === 'paid' || fin === 'partially_paid') {
        if (!ful || ful === 'unfulfilled' || ful === 'unshipped' || ful === 'restocked') return 'paid';
        return 'preparing';
    }
    return null;
}

/**
 * Toss Place Order.orderState (Open API order-model).
 * COMPLETED = paid walk-in sale; CANCELLED = declined / refunded.
 * REQUESTED / OPENED / UNDEFINED are excluded from the v1 poll.
 */
export function tossPlaceToCanonical(orderState: string | null | undefined): CanonicalStatus | null {
    switch ((orderState ?? '').toUpperCase()) {
        case 'COMPLETED':
            return 'paid';
        case 'CANCELLED':
            return 'cancelled';
        default:
            return null;
    }
}
