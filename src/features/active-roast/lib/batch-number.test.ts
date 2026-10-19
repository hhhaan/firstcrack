import { describe, expect, it } from 'vitest';
import { allocateBatchNumber, emptyBatchNumberLedger, parseBatchNumberLedger } from './batch-number';

describe('device profile Charge numbering', () => {
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
