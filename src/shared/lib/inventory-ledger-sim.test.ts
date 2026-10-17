import { describe, expect, it } from 'vitest';
import { applyPackagingOp, applyRoastedEvents, emptyLedger, type RoastedEvent } from './inventory-ledger-sim';

describe('inventory simulator SQL parity', () => {
    it('replaces estimated inbound grams without changing source or adding a row', () => {
        const ledger = emptyLedger();
        applyRoastedEvents(ledger, [
            { event_type: 'roast_inbound', reference_id: 'session', bean_id: 'a', delta_grams: 850, is_estimate: true },
        ]);
        expect(
            applyRoastedEvents(ledger, [
                {
                    event_type: 'roast_inbound',
                    reference_id: 'session',
                    bean_id: 'b',
                    delta_grams: 820,
                    is_estimate: false,
                },
            ]),
        ).toBe(0);
        expect(ledger.roasted).toEqual([
            {
                event_type: 'roast_inbound',
                reference_id: 'session',
                bean_id: 'a',
                delta_grams: 820,
                is_estimate: false,
            },
        ]);
    });

    it.each(['packaging', 'blend_produce'])('%s is unique by reference across sources', (event_type) => {
        const ledger = emptyLedger();
        expect(applyRoastedEvents(ledger, [{ event_type, reference_id: 'op', bean_id: 'a', delta_grams: -100 }])).toBe(
            1,
        );
        expect(applyRoastedEvents(ledger, [{ event_type, reference_id: 'op', blend_id: 'b', delta_grams: -200 }])).toBe(
            0,
        );
    });

    it('keeps both blend consume inputs and ignores duplicates by bean', () => {
        const ledger = emptyLedger();
        const events = ['a', 'b'].map((bean_id) => ({
            event_type: 'blend_consume',
            reference_id: 'op',
            bean_id,
            blend_id: 'blend',
            delta_grams: -100,
        }));
        expect(applyRoastedEvents(ledger, events)).toBe(2);
        expect(applyRoastedEvents(ledger, events)).toBe(0);
    });

    it('does not deduplicate unindexed adjustment or null-reference rows', () => {
        const ledger = emptyLedger();
        const adjustment = { event_type: 'adjustment', reference_id: 'ref', bean_id: 'a', delta_grams: 10 };
        const packaging = { ...adjustment, event_type: 'packaging', reference_id: null };
        expect(applyRoastedEvents(ledger, [adjustment, adjustment, packaging, packaging])).toBe(4);
    });

    it('discards the first insert and earlier updates when the second insert throws', () => {
        const ledger = emptyLedger();
        const inbound = {
            event_type: 'roast_inbound',
            reference_id: 'session',
            bean_id: 'a',
            delta_grams: 100,
            is_estimate: true,
        };
        applyRoastedEvents(ledger, [inbound]);
        const before = structuredClone(ledger);
        const failing = {
            get reference_id(): string {
                throw new Error('insert failed');
            },
            bean_id: 'a',
            event_type: 'packaging',
            delta_grams: -100,
        } satisfies RoastedEvent;
        expect(() =>
            applyPackagingOp(
                ledger,
                [{ product_id: 'product', event_type: 'packaging', reference_id: 'op', delta_units: 1 }],
                [{ ...inbound, delta_grams: 90, is_estimate: false }, failing],
            ),
        ).toThrow('insert failed');
        expect(ledger).toEqual(before);
    });
});
