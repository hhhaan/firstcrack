import { describe, expect, it } from 'vitest';
import { computeBatchQuota } from './useBatchQuota';

describe('computeBatchQuota', () => {
    it('event trial counts only its grant, including slots held by running batches', () => {
        expect(computeBatchQuota({ plan: 'trial-event', lifetimeCount: 500, monthCount: 250, eventCount: 99 })).toEqual(
            {
                isTrial: true,
                max: 100,
                exceeded: false,
            },
        );
        expect(computeBatchQuota({ plan: 'trial-event', eventCount: 100 }).exceeded).toBe(true);
        expect(computeBatchQuota({ plan: 'tester', eventCount: 100, lifetimeCount: 1000 }).exceeded).toBe(false);
    });
    it('trial: gated by lifetime cap, ignores month count', () => {
        expect(computeBatchQuota({ plan: 'trial', lifetimeCount: 19, monthCount: 999 }).exceeded).toBe(false);
        expect(computeBatchQuota({ plan: 'trial', lifetimeCount: 20, monthCount: 0 }).exceeded).toBe(true);
    });

    it('pro: gated by monthly cap, ignores lifetime count', () => {
        expect(computeBatchQuota({ plan: 'pro', lifetimeCount: 999, monthCount: 199 }).exceeded).toBe(false);
        expect(computeBatchQuota({ plan: 'pro', lifetimeCount: 0, monthCount: 200 }).exceeded).toBe(true);
    });

    it('pro_plus: unlimited, never exceeded regardless of count', () => {
        const quota = computeBatchQuota({ plan: 'pro_plus', monthCount: 100_000 });
        expect(quota.max).toBeNull();
        expect(quota.exceeded).toBe(false);
    });

    it('read_only: monthly cap is 0, exceeded as soon as a count loads', () => {
        expect(computeBatchQuota({ plan: 'read_only', monthCount: 0 }).exceeded).toBe(true);
    });

    it('count not yet loaded → fail-open, never blocks', () => {
        expect(computeBatchQuota({ plan: 'pro' }).exceeded).toBe(false);
        expect(computeBatchQuota({ plan: 'trial' }).exceeded).toBe(false);
        expect(computeBatchQuota({ plan: 'read_only' }).exceeded).toBe(false);
    });
});
