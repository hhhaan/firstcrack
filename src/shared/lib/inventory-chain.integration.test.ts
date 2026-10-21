/**
 * Multi-ledger chain integration: real event builders + in-memory ledger
 * mirroring production partial unique keys (no live Postgres required).
 */
import { buildRoastStockEvents } from '@features/active-roast/lib/buildRoastStockEvents';
import { buildBlendingEvents } from '@features/blend-roasted/lib/buildBlendingEvents';
import { buildPackagingEvents } from '@features/package-product/lib/buildPackagingEvents';
import { describe, expect, it } from 'vitest';
import {
    applyBeanEvents,
    applyPackagingOp,
    applyProductEvents,
    applyRoastedEvents,
    emptyLedger,
    sumBeanGrams,
    sumProductUnits,
    sumRoastedGrams,
} from './inventory-ledger-sim';

const USER = 'user-1';
const BEAN = 'bean-1';
const PRODUCT = 'product-1';
const NET_G = 250;

describe('inventory chain integration', () => {
    it('happy path: purchase → roast → package → fulfill', () => {
        const ledger = emptyLedger();
        const sessionId = 'sess-1';
        const lineId = 'line-1';
        const packageOpId = 'pack-op-1';

        // green purchase 10kg
        applyBeanEvents(ledger, [{ bean_id: BEAN, delta_grams: 10_000, event_type: 'purchase', reference_id: null }]);

        // roast save: green −5kg + bulk inbound 4.2kg measured
        const green = buildRoastStockEvents({
            userId: USER,
            deductionGrams: 5000,
            singleBeanId: BEAN,
            blendId: null,
            referenceId: sessionId,
        });
        applyBeanEvents(ledger, green);
        applyRoastedEvents(ledger, [
            {
                bean_id: BEAN,
                blend_id: null,
                delta_grams: 4200,
                event_type: 'roast_inbound',
                reference_id: sessionId,
                is_estimate: false,
            },
        ]);

        // package 10 bags × 250g
        const { productEvents, roastedEvents } = buildPackagingEvents({
            userId: USER,
            productId: PRODUCT,
            units: 10,
            netWeightGrams: NET_G,
            beanId: BEAN,
            blendId: null,
            opId: packageOpId,
        });
        applyPackagingOp(ledger, productEvents, roastedEvents);

        // fulfill 4 units (order_line ref)
        applyProductEvents(ledger, [
            {
                product_id: PRODUCT,
                delta_units: -4,
                event_type: 'order_fulfillment',
                reference_id: lineId,
            },
        ]);

        expect(sumBeanGrams(ledger, BEAN)).toBe(5000);
        expect(sumRoastedGrams(ledger, { beanId: BEAN })).toBe(4200 - 10 * NET_G); // 1700
        expect(sumProductUnits(ledger, PRODUCT)).toBe(10 - 4);
        expect(ledger.bean.some((e) => e.event_type === 'roast')).toBe(true);
        expect(ledger.roasted.some((e) => e.event_type === 'packaging')).toBe(true);
        expect(ledger.product.some((e) => e.event_type === 'order_fulfillment')).toBe(true);
    });

    it('packaging same opId twice inserts once (H5 / partial unique)', () => {
        const ledger = emptyLedger();
        applyRoastedEvents(ledger, [
            {
                bean_id: BEAN,
                blend_id: null,
                delta_grams: 10_000,
                event_type: 'roast_inbound',
                reference_id: 'sess-in',
            },
        ]);

        const opId = 'stable-pack-op';
        const built = buildPackagingEvents({
            userId: USER,
            productId: PRODUCT,
            units: 4,
            netWeightGrams: NET_G,
            beanId: BEAN,
            blendId: null,
            opId,
        });

        const first = applyPackagingOp(ledger, built.productEvents, built.roastedEvents);
        const second = applyPackagingOp(ledger, built.productEvents, built.roastedEvents);

        expect(first.productInserted).toBe(1);
        expect(first.roastedInserted).toBe(1);
        expect(second.productInserted).toBe(0);
        expect(second.roastedInserted).toBe(0);
        expect(sumProductUnits(ledger, PRODUCT)).toBe(4);
        expect(sumRoastedGrams(ledger, { beanId: BEAN })).toBe(10_000 - 4 * NET_G);
    });

    it('fulfill same line twice does not double-deduct product', () => {
        const ledger = emptyLedger();
        applyProductEvents(ledger, [
            {
                product_id: PRODUCT,
                delta_units: 10,
                event_type: 'roast_inbound',
                reference_id: 'pack-1',
            },
        ]);
        const line = {
            product_id: PRODUCT,
            delta_units: -3,
            event_type: 'order_fulfillment',
            reference_id: 'line-dup',
        };
        expect(applyProductEvents(ledger, [line])).toBe(1);
        expect(applyProductEvents(ledger, [line])).toBe(0);
        expect(sumProductUnits(ledger, PRODUCT)).toBe(7);
    });

    it('blend consume/produce share opId; retry is no-op', () => {
        const ledger = emptyLedger();
        const blendId = 'blend-1';
        const beanA = 'bean-a';
        const beanB = 'bean-b';
        for (const id of [beanA, beanB]) {
            applyRoastedEvents(ledger, [
                {
                    bean_id: id,
                    blend_id: null,
                    delta_grams: 5000,
                    event_type: 'roast_inbound',
                    reference_id: `in-${id}`,
                },
            ]);
        }

        const opId = 'blend-op-1';
        const events = buildBlendingEvents({
            userId: USER,
            blendId,
            inputs: [
                { beanId: beanA, grams: 3000 },
                { beanId: beanB, grams: 2000 },
            ],
            outputGrams: 4900,
            opId,
        });

        expect(applyRoastedEvents(ledger, events)).toBe(3);
        expect(applyRoastedEvents(ledger, events)).toBe(0);
        expect(sumRoastedGrams(ledger, { beanId: beanA })).toBe(2000);
        expect(sumRoastedGrams(ledger, { beanId: beanB })).toBe(3000);
        expect(sumRoastedGrams(ledger, { blendId })).toBe(4900);
    });
});
