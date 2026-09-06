import { describe, expect, it } from 'vitest';
import {
    coffeeFuturesKeys,
    dashboardKeys,
    inventoryQueryRoots,
    orderKeys,
    planQueryRoots,
    productStockKeys,
    roastedStockKeys,
    weatherKeys,
} from './query-keys';
import { roastCurveKeys } from './roast-curve';

describe('query key factories', () => {
    it('planQueryRoots stay stable string prefixes', () => {
        expect(planQueryRoots.dayBatches).toEqual(['day_batches']);
        expect(planQueryRoots.batches).toEqual(['plan_batches']);
        expect(planQueryRoots.recurrenceRules).toEqual(['recurrence_rules']);
    });

    it('inventory roots stay hierarchical', () => {
        expect(inventoryQueryRoots.beanStockSummaries).toEqual(['bean-stock-summaries']);
        expect(inventoryQueryRoots.beanStockSummary).toEqual(['bean-stock-summary']);
        expect(inventoryQueryRoots.inventoryAlerts).toEqual(['inventory-alerts']);
        expect(inventoryQueryRoots.roastedStock).toEqual(['roasted-stock']);
        expect(inventoryQueryRoots.productStock).toEqual(['product-stock']);
        expect(roastedStockKeys.events('u1')).toEqual([...roastedStockKeys.byUser('u1'), 'events']);
        expect(productStockKeys.events('u1', 'p1')).toEqual([...productStockKeys.byUser('u1'), 'events', 'p1']);
        expect(inventoryQueryRoots.beanPurchaseCosts).toEqual(['bean-purchase-costs']);
    });

    it('cross-slice keys stay hierarchical', () => {
        expect(dashboardKeys.all('u1')).toEqual(['dashboard', 'u1']);
        expect(weatherKeys.coords).toEqual(['weather', 'coords']);
        expect(weatherKeys.current(1, 2)).toEqual(['weather', 'current', 1, 2]);
        expect(coffeeFuturesKeys.all).toEqual(['coffee-futures']);
        expect(roastCurveKeys.byPath('a.tsv')).toEqual(['roast_curve', 'a.tsv']);
        expect(orderKeys.all('u1')).toEqual(['orders', 'u1']);
        expect(orderKeys.requirements('u1')).toEqual(['roasting-requirements', 'u1']);
    });
});
