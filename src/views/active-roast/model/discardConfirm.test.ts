import { describe, expect, it } from 'vitest';
import { reduceDiscardConfirm } from './discardConfirm';

describe('reduceDiscardConfirm (#167 P0.2)', () => {
    it('first Discard click does not wipe — only opens confirm', () => {
        const next = reduceDiscardConfirm(false, 'request');
        expect(next.confirming).toBe(true);
        expect(next.executeDiscard).toBe(false);
    });

    it('cancel keeps the session and local TSV', () => {
        const next = reduceDiscardConfirm(true, 'cancel');
        expect(next.confirming).toBe(false);
        expect(next.executeDiscard).toBe(false);
    });

    it('confirm is the only path that executes discard', () => {
        const next = reduceDiscardConfirm(true, 'confirm');
        expect(next.confirming).toBe(false);
        expect(next.executeDiscard).toBe(true);
    });

    it('confirm without a prior request does not wipe', () => {
        const next = reduceDiscardConfirm(false, 'confirm');
        expect(next.confirming).toBe(false);
        expect(next.executeDiscard).toBe(false);
    });
});
