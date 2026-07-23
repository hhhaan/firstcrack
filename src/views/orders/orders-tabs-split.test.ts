/**
 * CQ-R3: Orders shell is thin; tabs live under views/orders/ui (page-first).
 */
import { describe, expect, it } from 'vitest';
import orders from './Orders.tsx?raw';
import channelsTab from './ui/ChannelsTab.tsx?raw';
import ordersTab from './ui/OrdersTab.tsx?raw';
import productsTab from './ui/ProductsTab.tsx?raw';

describe('Orders page-first tab split', () => {
    it('Orders.tsx is a tab shell only', () => {
        expect(orders).toMatch(/OrdersTab/);
        expect(orders).toMatch(/ProductsTab/);
        expect(orders).toMatch(/ChannelsTab/);
        expect(orders).not.toMatch(/useFulfillOrder|usePackageProduct|useOrders\(/);
        // shell should stay small
        expect(orders.split('\n').length).toBeLessThan(100);
    });

    it('tab files own domain orchestration', () => {
        expect(ordersTab).toMatch(/useOrders|useFulfillOrder/);
        expect(productsTab).toMatch(/useProducts|usePackageProduct/);
        expect(channelsTab).toMatch(/useSalesChannels|useSyncOrders/);
    });
});
