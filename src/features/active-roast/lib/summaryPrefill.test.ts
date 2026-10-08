import type { PlanBatchHandoff } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import {
    isDeductDisplayEligible,
    scheduleLinkFieldPatch,
    summaryFormInitialValues,
    summaryPrefill,
} from './summaryPrefill';

const handoff = {
    planBatchId: 'pb1',
    beanId: 'bean-h',
    blendId: null,
    beanName: 'Handoff Bean',
    batchSizeKg: 5,
    batchCount: 3,
    completedSessions: 0,
} as unknown as PlanBatchHandoff;

const lastAdhoc = { beanId: 'bean-a', weightKg: 3.5, roastLevel: 'Medium' };

describe('summaryPrefill', () => {
    it('handoff wins: weight/bean from handoff, adhoc ignored', () => {
        const r = summaryPrefill(handoff, lastAdhoc, 'bean-s');
        expect(r).toEqual({ weightGrams: 5, roastLevel: null, beanId: 'bean-h' });
    });

    it('adhoc: carries last weight/level, header bean selection beats last bean', () => {
        const r = summaryPrefill(null, lastAdhoc, 'bean-s');
        expect(r).toEqual({ weightGrams: 3.5, roastLevel: 'Medium', beanId: 'bean-s' });
    });

    it('adhoc without header selection falls back to last bean', () => {
        const r = summaryPrefill(null, lastAdhoc, null);
        expect(r.beanId).toBe('bean-a');
    });

    it('first batch of the day: all empty', () => {
        expect(summaryPrefill(null, null, null)).toEqual({ weightGrams: 0, roastLevel: null, beanId: null });
    });
});

describe('summary form policy', () => {
    const base = { weightGrams: 3.5, beanId: 'bean-s' as string | null };

    it('open values follow handoff, then header bean, and do not copy a later batch', () => {
        const opened = summaryFormInitialValues(handoff, lastAdhoc, 'bean-s');
        expect(opened.weightGrams).toBe(5);
        expect(opened.beanId).toBe('bean-h');
        expect(opened.linkMode).toBe('schedule');
        expect(opened.deductStock).toBe(true);
        expect(summaryFormInitialValues(null, lastAdhoc, 'bean-s').beanId).toBe('bean-s');
    });

    it('schedule select applies the batch and clear restores the open-time base', () => {
        const selected = scheduleLinkFieldPatch({
            prevMode: 'none',
            mode: 'schedule',
            batch: { id: 'b2', batchSizeKg: 8, beanId: 'bean-2' },
            prevBatchId: null,
            base,
        });
        expect(selected).toEqual({ weightGrams: 8, beanId: 'bean-2' });
        expect(
            scheduleLinkFieldPatch({
                prevMode: 'schedule',
                mode: 'schedule',
                batch: { id: 'b2', batchSizeKg: 8, beanId: 'bean-2' },
                prevBatchId: 'b2',
                base,
            }),
        ).toBeNull();
        expect(
            scheduleLinkFieldPatch({
                prevMode: 'schedule',
                mode: 'none',
                batch: null,
                prevBatchId: 'b2',
                base,
            }),
        ).toEqual(base);
    });

    it('deduct display is not the save-path inventory check', () => {
        expect(
            isDeductDisplayEligible({ customBean: false, deductionKg: 5, resolvedBeanId: 'bean-1', blendId: null }),
        ).toBe(true);
        expect(isDeductDisplayEligible({ customBean: true, deductionKg: 5, resolvedBeanId: null, blendId: null })).toBe(
            false,
        );
        expect(
            isDeductDisplayEligible({ customBean: false, deductionKg: 0, resolvedBeanId: 'bean-1', blendId: null }),
        ).toBe(false);
    });
});
