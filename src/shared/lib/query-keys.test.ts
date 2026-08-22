import { stockEventKeys } from '@entities/bean-stock-event/queries';
import { inventoryAlertKeys } from '@entities/inventory-alert/queries';
import { planKeys } from '@entities/plan/queries';
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
    it('planKeys compose from planQueryRoots (stable string prefixes)', () => {
        expect(planKeys.dayBatches('u1', '2026-07-01')).toEqual([...planQueryRoots.dayBatches, 'u1', '2026-07-01']);
        expect(planKeys.dayBatches('u1', '2026-07-01')[0]).toBe('day_batches');
        expect(planKeys.batches('p1')[0]).toBe('plan_batches');
        expect(planKeys.recurrenceRules('u1')).toEqual([...planQueryRoots.recurrenceRules, 'u1']);
        // root prefixes enable partial invalidation without raw strings
        expect(planKeys.dayBatchesRoot).toBe(planQueryRoots.dayBatches);
        expect(planKeys.batchesRoot).toEqual(['plan_batches']);
    });

    it('stock + alert keys share inventoryQueryRoots', () => {
        expect(stockEventKeys.summariesByUser('u1')).toEqual([...inventoryQueryRoots.beanStockSummaries, 'u1']);
        expect(stockEventKeys.summary('b1')).toEqual([...inventoryQueryRoots.beanStockSummary, 'b1']);
        expect(stockEventKeys.summariesRoot).toBe(inventoryQueryRoots.beanStockSummaries);
        expect(inventoryAlertKeys.all).toBe(inventoryQueryRoots.inventoryAlerts);
        expect(inventoryAlertKeys.list('u1')).toEqual([...inventoryQueryRoots.inventoryAlerts, 'u1']);
        expect(inventoryQueryRoots.roastedStock).toEqual(['roasted-stock']);
        expect(inventoryQueryRoots.productStock).toEqual(['product-stock']);
        expect(roastedStockKeys.events('u1')).toEqual([...roastedStockKeys.byUser('u1'), 'events']);
        expect(productStockKeys.events('u1', 'p1')).toEqual([...productStockKeys.byUser('u1'), 'events', 'p1']);
        expect(stockEventKeys.purchaseCostsByUser('u1')).toEqual([...inventoryQueryRoots.beanPurchaseCosts, 'u1']);
        expect(stockEventKeys.purchaseCostsRoot).toBe(inventoryQueryRoots.beanPurchaseCosts);
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
