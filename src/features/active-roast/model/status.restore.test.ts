import { beforeEach, describe, expect, it } from 'vitest';
import { useRoastingStore } from './status';

describe('restoreDraft (#354)', () => {
    beforeEach(() => {
        useRoastingStore.getState().reset();
    });

    it('hydrates roasting so tick and close-guard survive remount', () => {
        useRoastingStore.getState().restoreDraft({
            sessionId: 's-restore',
            roastStartMs: 1_700_000_000_000,
            elapsed: 480,
        });
        const s = useRoastingStore.getState();
        expect(s.phase).toBe('roasting');
        expect(s.isRoasting).toBe(true);
        expect(s.charged).toBe(true);
        expect(s.sessionId).toBe('s-restore');
        expect(s.roastStartMs).toBe(1_700_000_000_000);
        expect(s.elapsed).toBe(480);
    });

    it('does not mint a new sessionId when already roasting', () => {
        useRoastingStore.getState().startCharge(1_700_000_000_000);
        const first = useRoastingStore.getState().sessionId;
        useRoastingStore.getState().restoreDraft({
            sessionId: 'other',
            roastStartMs: 1,
            elapsed: 1,
        });
        expect(useRoastingStore.getState().sessionId).toBe(first);
        expect(useRoastingStore.getState().sessionId).not.toBe('other');
    });
});
