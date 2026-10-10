import { describe, expect, it } from 'vitest';
import { shouldResetSidecarAfterSummaryDiscard } from './drop-cancel-sidecar';

describe('shouldResetSidecarAfterSummaryDiscard', () => {
    it('skips sidecar reset when batch B is roasting (A discard during B)', () => {
        const live = { sessionId: 's-b', phase: 'roasting' as const, awaitingNextCharge: false };
        expect(shouldResetSidecarAfterSummaryDiscard(live, 's-a', true)).toBe(false);
    });

    it('resets when discard applied and no other batch owns the machine', () => {
        const live = { sessionId: null, phase: 'standby' as const, awaitingNextCharge: true };
        expect(shouldResetSidecarAfterSummaryDiscard(live, 's-a', true)).toBe(true);
    });

    it('resets when still awaiting charge after A drop (session not yet detached)', () => {
        const live = { sessionId: 's-a', phase: 'standby' as const, awaitingNextCharge: true };
        expect(shouldResetSidecarAfterSummaryDiscard(live, 's-a', true)).toBe(true);
    });

    it('does not reset when discard did not apply', () => {
        const live = { sessionId: null, phase: 'standby' as const, awaitingNextCharge: true };
        expect(shouldResetSidecarAfterSummaryDiscard(live, 's-a', false)).toBe(false);
    });
});
