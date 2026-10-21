import { describe, expect, it } from 'vitest';
import { allocateBatchNumber, emptyBatchNumberLedger } from './batch-number';
import { automaticBatchTitle } from './batch-title';

describe('batch titles and overall Charge numbering', () => {
    it('keeps profile and workspace-wide identities across a restored session', () => {
        const first = allocateBatchNumber(emptyBatchNumberLedger(), 'owner', 'p1', 's1');
        const second = allocateBatchNumber(first.ledger, 'owner', 'p2', 's2');
        expect([second.number, second.totalNumber]).toEqual([1, 2]);
        const restored = allocateBatchNumber(second.ledger, 'owner', 'p2', 's1');
        expect([restored.number, restored.totalNumber]).toEqual([1, 1]);
        expect(allocateBatchNumber(second.ledger, 'other', 'p1', 's3').totalNumber).toBe(1);
    });
    it('starts overall numbering from the existing device profile counters', () => {
        const counters = { [JSON.stringify(['owner', 'p1'])]: 4, [JSON.stringify(['owner', 'p2'])]: 3 };
        expect(allocateBatchNumber({ counters, sessions: {} }, 'owner', 'p1', 'next').totalNumber).toBe(8);
    });
    it('keeps the selected identifiers when a profile name is long', () => {
        const identity = {
            profileId: 'p',
            name: 'x'.repeat(150),
            number: 42,
            totalNumber: 600,
            numbering: 'both' as const,
        };
        const title = automaticBatchTitle(identity);
        expect(title.length).toBe(120);
        expect(title).toMatch(/#42 · Σ#600$/);
        expect(automaticBatchTitle({ ...identity, numbering: 'total', name: 'Filter' })).toBe('Filter · Σ#600');
    });
});
