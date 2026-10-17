/**
 * Fold Naver product orders into one canonical order.
 * A cancelled product order cancels its own line. The order is cancelled or
 * refunded only when every line in this payload is terminal. Callers that see
 * only the changed product order still rely on sync_channel_orders_batch,
 * which keeps the header open while any stored sibling line is active.
 */
import { lineQuantity } from './normalize.ts';
import type { CanonicalOrder, CanonicalStatus } from './types.ts';

const RANK: Record<string, number> = {
    pending: 0,
    paid: 1,
    preparing: 2,
    shipped: 3,
    delivered: 4,
};

type QuantityFields = {
    remainQuantity?: unknown;
    quantity?: unknown;
    initialQuantity?: unknown;
};

type PaymentFields = {
    remainPaymentAmount?: unknown;
    totalPaymentAmount?: unknown;
    initialPaymentAmount?: unknown;
};

function firstPositive(values: unknown[]): number {
    for (const value of values) {
        if (value == null || value === '') continue;
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
    }
    const fallback = values.find((value) => value != null && value !== '');
    return lineQuantity(fallback ?? 1);
}

/** Cancelled lines keep the ordered quantity. Remaining quantity is 0 after a full line cancel. */
export function naverCommercialQuantity(po: QuantityFields, terminal: boolean): number {
    const ordered = [po.initialQuantity, po.quantity, po.remainQuantity];
    const remain = [po.remainQuantity, po.quantity, po.initialQuantity];
    return firstPositive(terminal ? ordered : remain);
}

/** Cancelled lines keep the original payment. Remaining payment is 0 after a full line cancel. */
export function naverPaymentAmount(po: PaymentFields, terminal: boolean): number | null {
    const ordered = [po.initialPaymentAmount, po.totalPaymentAmount, po.remainPaymentAmount];
    const remain = [po.remainPaymentAmount, po.totalPaymentAmount, po.initialPaymentAmount];
    const amounts = (terminal ? ordered : remain)
        .filter((value) => value != null && value !== '')
        .map((value) => Number(value))
        .filter((amount) => Number.isFinite(amount));
    return amounts.find((amount) => amount > 0) ?? amounts[0] ?? null;
}

function statusFromParts(group: CanonicalOrder[]): CanonicalStatus {
    const lines = group.flatMap((order) => order.lines);
    if (lines.length > 0 && lines.every((line) => line.status !== 'active')) {
        return lines.some((line) => line.status === 'refunded') ? 'refunded' : 'cancelled';
    }
    let best: CanonicalStatus = 'paid';
    let bestRank = -1;
    for (const order of group) {
        if (order.status === 'cancelled' || order.status === 'refunded') continue;
        const rank = RANK[order.status] ?? 0;
        if (rank > bestRank) {
            bestRank = rank;
            best = order.status;
        }
    }
    return best;
}

export function mergeNaverOrdersByOrderId(parts: CanonicalOrder[]): CanonicalOrder[] {
    const groups = new Map<string, CanonicalOrder[]>();
    for (const order of parts) {
        const list = groups.get(order.platformOrderId);
        if (list) list.push(order);
        else groups.set(order.platformOrderId, [order]);
    }
    return [...groups.values()].map((group) => {
        const lines = group.flatMap((order) => order.lines);
        const lineSum = lines.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.quantity, 0);
        const stated = Math.max(0, ...group.map((order) => order.totalAmount ?? 0));
        const total = Math.max(lineSum, stated);
        return {
            ...group[0],
            status: statusFromParts(group),
            lines,
            totalAmount: total > 0 ? total : null,
        };
    });
}
