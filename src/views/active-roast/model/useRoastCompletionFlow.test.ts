import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { flowReducer } from './useRoastCompletionFlow';

const row = (id: string): PlanBatchWithProgress =>
    ({
        id,
        plan_id: 'plan-1',
        bean_id: 'bean-1',
        blend_id: null,
        bean_name: 'Ethiopia',
        batch_size_kg: 5,
        roast_profile_id: null,
        batch_count: 2,
        completed_sessions: 1,
    }) as PlanBatchWithProgress;

const base = {
    endRoastModal: false,
    summaryModal: true,
    summarySessionId: 's-a',
    continueModal: false,
    continueCandidates: [] as PlanBatchWithProgress[],
};

describe('flowReducer SAVE_SUCCESS', () => {
    it('opens continue with candidates', () => {
        const next = flowReducer(base, {
            type: 'SAVE_SUCCESS',
            payload: { shouldOpenContinue: true, continueCandidates: [row('a')] },
        });
        expect(next.continueModal).toBe(true);
        expect(next.summaryModal).toBe(false);
        expect(next.continueCandidates).toHaveLength(1);
        expect(next.continueCandidates[0].id).toBe('a');
    });

    it('closes summary without continue when no remaining', () => {
        const next = flowReducer(base, {
            type: 'SAVE_SUCCESS',
            payload: { shouldOpenContinue: false },
        });
        expect(next.continueModal).toBe(false);
        expect(next.continueCandidates).toEqual([]);
        expect(next.summaryModal).toBe(false);
    });

    it('DISMISS_CONTINUE clears candidates', () => {
        const open = flowReducer(base, {
            type: 'SAVE_SUCCESS',
            payload: { shouldOpenContinue: true, continueCandidates: [row('a')] },
        });
        const closed = flowReducer(open, { type: 'DISMISS_CONTINUE' });
        expect(closed.continueModal).toBe(false);
        expect(closed.continueCandidates).toEqual([]);
    });
});

/** UX contracts: accidental dismiss must not wipe recoverable save state without an explicit discard path. */
describe('flowReducer summary dismiss paths (UX friction contracts)', () => {
    it('CLOSE_SUMMARY hides modal but keeps summaryData for reopen (#172)', () => {
        const next = flowReducer(base, { type: 'CLOSE_SUMMARY' });
        expect(next.summaryModal).toBe(false);
        expect(next.summarySessionId).toBe(base.summarySessionId);
        expect(next.endRoastModal).toBe(false);
        expect(next.continueModal).toBe(false);
    });

    it('REOPEN_SUMMARY restores modal when summaryData exists', () => {
        const closed = flowReducer(base, { type: 'CLOSE_SUMMARY' });
        const reopened = flowReducer(closed, { type: 'REOPEN_SUMMARY', sessionId: 's-a' });
        expect(reopened.summaryModal).toBe(true);
        expect(reopened.summarySessionId).toBe(base.summarySessionId);
    });

    it('DISCARD_SUMMARY resets entire completion flow', () => {
        const next = flowReducer(
            {
                ...base,
                endRoastModal: true,
                continueModal: true,
                continueCandidates: [row('a')],
            },
            { type: 'DISCARD_SUMMARY' },
        );
        expect(next).toEqual({
            endRoastModal: false,
            summaryModal: false,
            summarySessionId: null,
            continueModal: false,
            continueCandidates: [],
        });
    });
});
