import type { PlanBatchHandoff } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { flowReducer } from './useRoastCompletionFlow';

const handoff = (id: string): PlanBatchHandoff => ({
    planBatchId: id,
    planId: 'plan-1',
    beanId: 'bean-1',
    blendId: null,
    beanName: 'Ethiopia',
    batchSizeKg: 5,
    profileId: null,
    batchCount: 2,
    completedSessions: 1,
});

const base = {
    endRoastModal: false,
    summaryModal: true,
    summaryData: { totalTime: '10:00', development: '2:00', finalBt: '200', logEntries: [] },
    continueModal: false,
    continueCandidates: [] as PlanBatchHandoff[],
};

describe('flowReducer SAVE_SUCCESS', () => {
    it('opens continue with candidates', () => {
        const next = flowReducer(base, {
            type: 'SAVE_SUCCESS',
            payload: { shouldOpenContinue: true, continueCandidates: [handoff('a')] },
        });
        expect(next.continueModal).toBe(true);
        expect(next.summaryModal).toBe(false);
        expect(next.continueCandidates).toHaveLength(1);
        expect(next.continueCandidates[0].planBatchId).toBe('a');
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
            payload: { shouldOpenContinue: true, continueCandidates: [handoff('a')] },
        });
        const closed = flowReducer(open, { type: 'DISMISS_CONTINUE' });
        expect(closed.continueModal).toBe(false);
        expect(closed.continueCandidates).toEqual([]);
    });
});

/** UX contracts: accidental dismiss must not wipe recoverable save state without an explicit discard path. */
describe('flowReducer summary dismiss paths (UX friction contracts)', () => {
    it('CLOSE_SUMMARY hides modal and clears summaryData (no reopen payload left)', () => {
        const next = flowReducer(base, { type: 'CLOSE_SUMMARY' });
        expect(next.summaryModal).toBe(false);
        expect(next.summaryData).toBeNull();
        // End-roast phase is outside this reducer; empty summaryData is the only UI reopen key.
        expect(next.endRoastModal).toBe(false);
        expect(next.continueModal).toBe(false);
    });

    it('DISCARD_SUMMARY resets entire completion flow (same wipe as close for summary fields)', () => {
        const next = flowReducer(
            {
                ...base,
                endRoastModal: true,
                continueModal: true,
                continueCandidates: [handoff('a')],
            },
            { type: 'DISCARD_SUMMARY' },
        );
        expect(next).toEqual({
            endRoastModal: false,
            summaryModal: false,
            summaryData: null,
            continueModal: false,
            continueCandidates: [],
        });
    });
});
