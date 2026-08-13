import type { PlanBatchHandoff } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { closeSummaryAction, discardSummaryAction, flowReducer, isEndRoastDisabled } from './useRoastCompletionFlow';

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
    it('overlay closer (CLOSE_SUMMARY) hides modal but keeps summaryData (#167 P0.1)', () => {
        const next = flowReducer(base, closeSummaryAction());
        expect(next.summaryModal).toBe(false);
        expect(next.summaryData).toEqual(base.summaryData);
        expect(next.endRoastModal).toBe(false);
        expect(next.continueModal).toBe(false);
    });

    it('overlay closer does not end the save flow — only discard/save wipe payload', () => {
        const overlay = flowReducer(base, closeSummaryAction());
        const discarded = flowReducer(base, discardSummaryAction());
        expect(overlay.summaryData).toEqual(base.summaryData);
        expect(discarded.summaryData).toBeNull();
        expect(discarded).toEqual({
            endRoastModal: false,
            summaryModal: false,
            summaryData: null,
            continueModal: false,
            continueCandidates: [],
        });
    });

    it('REOPEN_SUMMARY restores modal when summaryData exists', () => {
        const closed = flowReducer(base, { type: 'CLOSE_SUMMARY' });
        const reopened = flowReducer(closed, { type: 'REOPEN_SUMMARY' });
        expect(reopened.summaryModal).toBe(true);
        expect(reopened.summaryData).toEqual(base.summaryData);
    });

    it('REOPEN_SUMMARY is no-op without summaryData', () => {
        const empty = { ...base, summaryModal: false, summaryData: null };
        const next = flowReducer(empty, { type: 'REOPEN_SUMMARY' });
        expect(next.summaryModal).toBe(false);
        expect(next.summaryData).toBeNull();
    });

    it('DISCARD_SUMMARY resets entire completion flow', () => {
        const next = flowReducer(
            {
                ...base,
                endRoastModal: true,
                continueModal: true,
                continueCandidates: [handoff('a')],
            },
            discardSummaryAction(),
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

describe('isEndRoastDisabled (#167 P0.1 save re-entry)', () => {
    it('stays enabled after overlay close when summaryData remains', () => {
        expect(isEndRoastDisabled({ charged: true, roastEnded: true, hasSummaryData: true })).toBe(false);
    });

    it('disables after discard/save when no summaryData remains', () => {
        expect(isEndRoastDisabled({ charged: true, roastEnded: true, hasSummaryData: false })).toBe(true);
    });

    it('disables before charge', () => {
        expect(isEndRoastDisabled({ charged: false, roastEnded: false, hasSummaryData: false })).toBe(true);
    });
});
