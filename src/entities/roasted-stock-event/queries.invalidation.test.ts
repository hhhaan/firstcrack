import { inventoryQueryRoots, productStockKeys, roastedStockKeys } from '@shared/lib/query-keys';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

describe('roasted/product stock key nesting', () => {
    it('roasted events nest under byUser — old sibling key must not be used', () => {
        const uid = 'user-1';
        expect(roastedStockKeys.byUser(uid)).toEqual([...inventoryQueryRoots.roastedStock, uid]);
        expect(roastedStockKeys.events(uid)).toEqual([...roastedStockKeys.byUser(uid), 'events']);
        expect(roastedStockKeys.events(uid)).not.toEqual([...inventoryQueryRoots.roastedStock, 'events', uid]);
        expect(roastedStockKeys.events(uid)[1]).not.toBe('events');
    });

    it('product events nest under byUser', () => {
        const uid = 'user-1';
        const pid = 'prod-1';
        expect(productStockKeys.events(uid, pid)).toEqual([...productStockKeys.byUser(uid), 'events', pid]);
        expect(productStockKeys.events(uid, pid)).not.toEqual([...inventoryQueryRoots.productStock, 'events', pid]);
    });

    it('invalidate(byUser) marks nested roasted events stale (deduct/save/package/blend/delete)', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        const uid = 'user-1';
        const eventsKey = roastedStockKeys.events(uid);
        const siblingKey = [...inventoryQueryRoots.roastedStock, 'events', uid] as const;
        qc.setQueryData(eventsKey, [{ id: 'ev-1' }]);
        qc.setQueryData(siblingKey, [{ id: 'stale-sibling' }]);

        await qc.invalidateQueries({ queryKey: roastedStockKeys.byUser(uid) });

        expect(qc.getQueryState(eventsKey)?.isInvalidated).toBe(true);
        // Old sibling shape is not a child of byUser — would stay fresh forever
        expect(qc.getQueryState(siblingKey)?.isInvalidated).toBe(false);
    });
});
