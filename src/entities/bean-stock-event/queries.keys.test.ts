import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { describe, expect, it } from 'vitest';
import { stockEventKeys } from './queries';

describe('stockEventKeys compose from inventoryQueryRoots', () => {
    it('shares summaries/summary/purchase-cost roots', () => {
        expect(stockEventKeys.summariesByUser('u1')).toEqual([...inventoryQueryRoots.beanStockSummaries, 'u1']);
        expect(stockEventKeys.summary('b1')).toEqual([...inventoryQueryRoots.beanStockSummary, 'b1']);
        expect(stockEventKeys.summariesRoot).toBe(inventoryQueryRoots.beanStockSummaries);
        expect(stockEventKeys.purchaseCostsByUser('u1')).toEqual([...inventoryQueryRoots.beanPurchaseCosts, 'u1']);
        expect(stockEventKeys.purchaseCostsRoot).toBe(inventoryQueryRoots.beanPurchaseCosts);
    });
});
