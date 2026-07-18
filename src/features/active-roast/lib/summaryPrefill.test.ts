import type { PlanBatchHandoff } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { summaryPrefill } from './summaryPrefill';

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
