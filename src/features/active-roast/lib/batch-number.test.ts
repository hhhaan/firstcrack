import { describe, expect, it } from 'vitest';
import {
    allocateBatchNumber,
    emptyBatchNumberLedger,
    mergeBatchNumberLedgers,
    parseBatchNumberLedger,
} from './batch-number';

describe('device profile Charge numbering', () => {
    it.each([false, true])('keeps the newest counter when local storage is newer=%s', (localIsNewer) => {
        const first = allocateBatchNumber(emptyBatchNumberLedger(), 'owner', 'p', 'a');
        const second = allocateBatchNumber(first.ledger, 'owner', 'p', 'b');
        const merged = localIsNewer
            ? mergeBatchNumberLedgers(first.ledger, second.ledger)
            : mergeBatchNumberLedgers(second.ledger, first.ledger);
        expect(allocateBatchNumber(merged, 'owner', 'p', 'c').number).toBe(3);
        expect(allocateBatchNumber(merged, 'owner', 'changed', 'b').number).toBe(2);
    });
    it.each([null, { counters: [], sessions: [] }, { counters: { bad: 'value' }, sessions: {} }])(
        'does not let malformed storage mask a valid allocation',
        (invalid) => {
            const first = allocateBatchNumber(emptyBatchNumberLedger(), 'owner', 'p', 'a');
            for (const merged of [
                mergeBatchNumberLedgers(first.ledger, invalid),
                mergeBatchNumberLedgers(invalid, first.ledger),
            ])
                expect(allocateBatchNumber(merged, 'owner', 'p', 'b').number).toBe(2);
        },
    );
    it('preserves durable session identities and covers every recovered allocation', () => {
        const scope = JSON.stringify(['owner', 'p']);
        const id = JSON.stringify(['owner', 'a']);
        const merged = mergeBatchNumberLedgers(
            { counters: {}, sessions: { [id]: { scope, number: 7 } } },
            { counters: {}, sessions: { [id]: { scope, number: 8 } } },
        );
        expect(allocateBatchNumber(merged, 'owner', 'p', 'a').number).toBe(7);
        expect(allocateBatchNumber(merged, 'owner', 'p', 'b').number).toBe(9);
    });
    it('preserves the same session across reopening, Drop cancel, and reference changes', () => {
        const first = allocateBatchNumber(emptyBatchNumberLedger(), 'owner', 'profile', 'a');
        const restored = parseBatchNumberLedger(JSON.parse(JSON.stringify(first.ledger)));
        expect(allocateBatchNumber(restored, 'owner', 'different-profile', 'a').number).toBe(1);
        expect(allocateBatchNumber(restored, 'owner', 'profile', 'b').number).toBe(2);
    });
    it('isolates workspaces/profiles and retains gaps after discarded batches', () => {
        const first = allocateBatchNumber(emptyBatchNumberLedger(), 'owner', 'p', 'discarded');
        const next = allocateBatchNumber(first.ledger, 'owner', 'p', 'next');
        expect(next.number).toBe(2);
        expect(allocateBatchNumber(next.ledger, 'other', 'p', 'next').number).toBe(1);
        expect(allocateBatchNumber(next.ledger, 'owner', null, 'adhoc').number).toBe(1);
    });
    it('retains cumulative counters after pruning old allocations', () => {
        let ledger = emptyBatchNumberLedger();
        for (let n = 0; n < 300; n++) ledger = allocateBatchNumber(ledger, 'owner', 'p', `${n}`).ledger;
        expect(Object.keys(ledger.sessions)).toHaveLength(256);
        expect(allocateBatchNumber(ledger, 'owner', 'p', '300').number).toBe(301);
    });
});
