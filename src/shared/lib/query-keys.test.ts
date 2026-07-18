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
    roastChartKeys,
    weatherKeys,
} from './query-keys';

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
    });

    it('cross-slice keys stay hierarchical', () => {
        expect(dashboardKeys.all('u1')).toEqual(['dashboard', 'u1']);
        expect(weatherKeys.coords).toEqual(['weather', 'coords']);
        expect(weatherKeys.current(1, 2)).toEqual(['weather', 'current', 1, 2]);
        expect(coffeeFuturesKeys.all).toEqual(['coffee-futures']);
        expect(roastChartKeys.history('a.tsv')).toEqual(['history-chart', 'a.tsv']);
        expect(orderKeys.all('u1')).toEqual(['orders', 'u1']);
        expect(orderKeys.requirements('u1')).toEqual(['roasting-requirements', 'u1']);
    });
});
