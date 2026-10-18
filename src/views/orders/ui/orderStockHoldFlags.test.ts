import { describe, expect, it } from 'vitest';
import { canRetryHold, stockHoldBadgeKey } from './orderStockHoldFlags';

describe('order stock hold retry flag', () => {
    it('shows retry for shipped channel orders with an open hold', () => {
        expect(canRetryHold({ hold: true, fulfilled: false, cancelled: false, status: 'shipped' })).toBe(true);
    });

    it('hides retry once fulfilled or cancelled', () => {
        expect(canRetryHold({ hold: true, fulfilled: true, cancelled: false, status: 'shipped' })).toBe(false);
        expect(canRetryHold({ hold: true, fulfilled: false, cancelled: true, status: 'shipped' })).toBe(false);
    });

    it('keeps retry visible for no_stock_demand holds', () => {
        expect(canRetryHold({ hold: true, fulfilled: false, cancelled: false, status: 'shipped' })).toBe(true);
    });
});

describe('order stock hold badge key', () => {
    it('uses the no-demand badge when reason is no_stock_demand', () => {
        expect(stockHoldBadgeKey('no_stock_demand')).toBe('orders.order.stockHoldNoDemandBadge');
    });

    it('uses the shortage badge for insufficient stock and unknown reasons', () => {
        expect(stockHoldBadgeKey('insufficient_product_stock')).toBe('orders.order.stockHoldBadge');
        expect(stockHoldBadgeKey(null)).toBe('orders.order.stockHoldBadge');
    });
});
