import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { batchStatus, getRecurrenceLabel, toDateKey, unknownErrorMessage } from './lib';

const batch = (partial: Partial<PlanBatchWithProgress>): PlanBatchWithProgress =>
    ({
        id: 'b1',
        plan_id: 'p1',
        bean_name: 'x',
        batch_count: 3,
        completed_sessions: 0,
        status: 'pending',
        ...partial,
    }) as PlanBatchWithProgress;

describe('batchStatus', () => {
    it('respects explicit done/skipped', () => {
        expect(batchStatus(batch({ status: 'done', completed_sessions: 0 }))).toBe('done');
        expect(batchStatus(batch({ status: 'skipped', completed_sessions: 0 }))).toBe('skipped');
    });

    it('derives done when sessions complete batch_count', () => {
        expect(batchStatus(batch({ completed_sessions: 3, batch_count: 3, status: 'pending' }))).toBe('done');
    });

    it('in-progress when some sessions done', () => {
        expect(batchStatus(batch({ completed_sessions: 1, batch_count: 3, status: 'pending' }))).toBe('in-progress');
    });

    it('pending when no sessions', () => {
        expect(batchStatus(batch({ completed_sessions: 0, batch_count: 2, status: 'pending' }))).toBe('pending');
    });
});

describe('getRecurrenceLabel / toDateKey', () => {
    it('maps rrule FREQ to labels', () => {
        expect(getRecurrenceLabel(null)).toBe('');
        expect(getRecurrenceLabel('FREQ=DAILY')).toBe('daily');
        expect(getRecurrenceLabel('FREQ=WEEKLY')).toBe('weekly');
        expect(getRecurrenceLabel('FREQ=WEEKLY;INTERVAL=2')).toBe('biweekly');
        expect(getRecurrenceLabel('FREQ=MONTHLY')).toBe('monthly');
        expect(getRecurrenceLabel('FREQ=YEARLY')).toBe('repeat');
    });

    it('formats local date key', () => {
        expect(toDateKey(new Date(2026, 6, 18))).toBe('2026-07-18');
    });
});

describe('unknownErrorMessage', () => {
    it('reads Error and Postgrest-like message fields', () => {
        expect(unknownErrorMessage(new Error('boom'))).toBe('boom');
        expect(unknownErrorMessage({ message: 'pg-fail' })).toBe('pg-fail');
        expect(unknownErrorMessage({ code: 1 })).toBe('{"code":1}');
    });
});
