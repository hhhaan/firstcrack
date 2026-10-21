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
        expect(allocateBatchNumber(merged, 'owner', 'changed', 'b').number).toBe(1);
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
    it('reuses each profile reservation on A → B → A without incrementing the overall number', () => {
        const initial = {
            counters: {
                [JSON.stringify(['owner', 'a'])]: 4,
                [JSON.stringify(['owner', 'b'])]: 8,
                [JSON.stringify(['owner', null, 'total'])]: 12,
            },
            sessions: {},
        };
        const a = allocateBatchNumber(initial, 'owner', 'a', 'running');
        const b = allocateBatchNumber(a.ledger, 'owner', 'b', 'running');
        const backToA = allocateBatchNumber(b.ledger, 'owner', 'a', 'running');
        const backToB = allocateBatchNumber(backToA.ledger, 'owner', 'b', 'running');
        expect([a.number, b.number, backToA.number, backToB.number]).toEqual([5, 9, 5, 9]);
        expect([a.totalNumber, b.totalNumber, backToA.totalNumber, backToB.totalNumber]).toEqual([13, 13, 13, 13]);
        const next = allocateBatchNumber(backToB.ledger, 'owner', 'b', 'next');
        expect([next.number, next.totalNumber]).toEqual([10, 14]);
    });
    it.each([false, true])('merges profile reservations after a partial write, local newer=%s', (localIsNewer) => {
        const a = allocateBatchNumber(emptyBatchNumberLedger(), 'owner', 'a', 'running');
        const b = allocateBatchNumber(a.ledger, 'owner', 'b', 'running');
        const merged = localIsNewer
            ? mergeBatchNumberLedgers(a.ledger, b.ledger)
            : mergeBatchNumberLedgers(b.ledger, a.ledger);
        const recoveredB = allocateBatchNumber(merged, 'owner', 'b', 'running');
        expect([recoveredB.number, recoveredB.totalNumber]).toEqual([1, 1]);
        const recoveredA = allocateBatchNumber(recoveredB.ledger, 'owner', 'a', 'running');
        expect([recoveredA.number, recoveredA.totalNumber]).toEqual([1, 1]);
        expect(allocateBatchNumber(recoveredA.ledger, 'owner', 'b', 'next').number).toBe(2);
    });
    it('migrates a legacy reservation without counting its profile correction as a new roast', () => {
        const scope = JSON.stringify(['owner', 'a']);
        const ledger = {
            counters: { [scope]: 4 },
            sessions: { [JSON.stringify(['owner', 'running'])]: { scope, number: 4 } },
        };
        const corrected = allocateBatchNumber(ledger, 'owner', 'b', 'running');
        expect([corrected.number, corrected.totalNumber]).toEqual([1, null]);
        const restored = parseBatchNumberLedger(JSON.parse(JSON.stringify(corrected.ledger)));
        expect(allocateBatchNumber(restored, 'owner', 'a', 'running').number).toBe(4);
        expect(allocateBatchNumber(restored, 'owner', 'b', 'next').totalNumber).toBe(5);
    });
    it('rejects malformed profile reservations while retaining a valid fallback ledger', () => {
        const valid = allocateBatchNumber(emptyBatchNumberLedger(), 'owner', 'a', 'running');
        const scope = JSON.stringify(['owner', 'a']);
        const invalid = {
            counters: { [scope]: 10 },
            sessions: { broken: { scope, number: 10, profileNumbers: { [scope]: 'bad' } } },
        };
        const merged = mergeBatchNumberLedgers(invalid, valid.ledger);
        expect(allocateBatchNumber(merged, 'owner', 'a', 'next').number).toBe(2);
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
