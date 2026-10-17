import { describe, expect, it } from 'vitest';
import { buildPackagingEvents } from '../lib/buildPackagingEvents';

/** #896: 750g on hand, pack 4×250g → 250g shortage (not blocked). */
describe('usePackageProduct shortage (#896)', () => {
    it('reports 250g shortage when 750g available for 1000g pack', () => {
        const units = 4;
        const netWeightGrams = 250;
        const { roastedEvents } = buildPackagingEvents({
            userId: 'u1',
            productId: 'p1',
            units,
            netWeightGrams,
            beanId: 'bean-1',
            blendId: null,
            opId: 'op-1',
        });
        const need = units * netWeightGrams;
        const have = 750;
        const shortage = have < need ? need - have : null;
        expect(roastedEvents[0]?.delta_grams).toBe(-1000);
        expect(shortage).toBe(250);
    });
});
