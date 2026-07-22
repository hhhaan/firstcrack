/**
 * Platform-agnostic sales rollups over orders SSoT.
 * Input = orders/order_lines only; channel taxonomy via sales-channel registry.
 * Never import POS adapters or platform-specific field names.
 */

import { type ChannelKind, getChannelKind } from '@shared/lib/channel-registry';
import type { OrderWithLines } from './api';

export type SalesPeriod = { from: string; to: string };

export type ChannelKindBucket = { revenue: number; orders: number };
export type PlatformBucket = { revenue: number; orders: number; channelKind: ChannelKind };
export type ProductBucket = {
    productId: string | null;
    title: string;
    quantity: number;
    revenue: number;
};

export type SalesFacts = {
    period: SalesPeriod;
    totalRevenue: number;
    orderCount: number;
    cancelledCount: number;
    /** cancelled+refunded / all in period (0 if empty). */
    cancelRate: number;
    /** totalRevenue / revenue-eligible order count. */
    aov: number;
    byChannelKind: Record<ChannelKind, ChannelKindBucket>;
    byPlatform: Record<string, PlatformBucket>;
    /** Top products by revenue (active lines only). */
    byProduct: ProductBucket[];
    /** Share of line qty with product_id null among active lines (0–1). */
    unmappedLineShare: number;
};

const REVENUE_STATUSES = new Set(['paid', 'preparing', 'shipped', 'delivered']);
const CANCEL_STATUSES = new Set(['cancelled', 'refunded']);

function emptyKindBuckets(): Record<ChannelKind, ChannelKindBucket> {
    return {
        marketplace: { revenue: 0, orders: 0 },
        pos: { revenue: 0, orders: 0 },
        manual: { revenue: 0, orders: 0 },
    };
}

function inPeriod(orderedAt: string, period: SalesPeriod): boolean {
    return orderedAt >= period.from && orderedAt <= period.to;
}

function lineRevenue(qty: number, unitPrice: number | null): number {
    if (unitPrice == null || !Number.isFinite(unitPrice)) return 0;
    return qty * unitPrice;
}

/**
 * Aggregate sales facts for a closed period (inclusive ISO bounds on ordered_at).
 * Revenue excludes cancelled/refunded orders; product mix uses active lines only.
 */
export function computeSalesFacts(orders: OrderWithLines[], period: SalesPeriod): SalesFacts {
    const byChannelKind = emptyKindBuckets();
    const byPlatform: Record<string, PlatformBucket> = {};
    const productMap = new Map<string, ProductBucket>();

    let totalRevenue = 0;
    let orderCount = 0;
    let revenueOrderCount = 0;
    let cancelledCount = 0;
    let activeLineQty = 0;
    let unmappedLineQty = 0;

    for (const order of orders) {
        if (!inPeriod(order.ordered_at, period)) continue;
        orderCount += 1;

        const kind = getChannelKind(order.platform);
        const platform = order.platform || 'unknown';

        if (!byPlatform[platform]) {
            byPlatform[platform] = { revenue: 0, orders: 0, channelKind: kind };
        }
        byPlatform[platform].orders += 1;
        byChannelKind[kind].orders += 1;

        if (CANCEL_STATUSES.has(order.status)) {
            cancelledCount += 1;
            continue;
        }

        if (!REVENUE_STATUSES.has(order.status) && order.status !== 'pending') {
            // unknown status: still count order, skip revenue
            continue;
        }

        // pending: count order, no revenue until paid
        if (order.status === 'pending') continue;

        const amount =
            order.total_amount != null && Number.isFinite(Number(order.total_amount))
                ? Number(order.total_amount)
                : (order.order_lines ?? [])
                      .filter((l) => l.status === 'active')
                      .reduce((s, l) => s + lineRevenue(l.quantity, l.unit_price), 0);

        totalRevenue += amount;
        revenueOrderCount += 1;
        byChannelKind[kind].revenue += amount;
        byPlatform[platform].revenue += amount;

        for (const line of order.order_lines ?? []) {
            if (line.status !== 'active') continue;
            activeLineQty += line.quantity;
            if (line.product_id == null) unmappedLineQty += line.quantity;

            const key = line.product_id ?? `title:${line.title}`;
            const existing = productMap.get(key);
            const rev = lineRevenue(line.quantity, line.unit_price);
            if (existing) {
                existing.quantity += line.quantity;
                existing.revenue += rev;
            } else {
                productMap.set(key, {
                    productId: line.product_id,
                    title: line.title,
                    quantity: line.quantity,
                    revenue: rev,
                });
            }
        }
    }

    const byProduct = [...productMap.values()].sort((a, b) => b.revenue - a.revenue);

    return {
        period,
        totalRevenue,
        orderCount,
        cancelledCount,
        cancelRate: orderCount === 0 ? 0 : cancelledCount / orderCount,
        aov: revenueOrderCount === 0 ? 0 : totalRevenue / revenueOrderCount,
        byChannelKind,
        byPlatform,
        byProduct,
        unmappedLineShare: activeLineQty === 0 ? 0 : unmappedLineQty / activeLineQty,
    };
}
