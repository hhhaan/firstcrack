import { describe, expect, it } from 'vitest';
import { computeBatchQuota } from './useBatchQuota';

describe('computeBatchQuota', () => {
    it('event trial counts only its grant, including slots held by running batches', () => {
        expect(computeBatchQuota({ plan: 'trial-event', chargeCount: 99 })).toEqual({
            isTrial: true,
            max: 100,
            exceeded: false,
        });
        expect(computeBatchQuota({ plan: 'trial-event', chargeCount: 100 }).exceeded).toBe(true);
        expect(computeBatchQuota({ plan: 'tester', chargeCount: 100 }).exceeded).toBe(false);
    });
    it('trial: gated by 20 lifetime Charges', () => {
        expect(computeBatchQuota({ plan: 'trial', chargeCount: 19 }).exceeded).toBe(false);
        expect(computeBatchQuota({ plan: 'trial', chargeCount: 20 }).exceeded).toBe(true);
    });

    it('pro: gated by 200 monthly Charges', () => {
        expect(computeBatchQuota({ plan: 'pro', chargeCount: 199 }).exceeded).toBe(false);
        expect(computeBatchQuota({ plan: 'pro', chargeCount: 200 }).exceeded).toBe(true);
    });

    it('pro_plus: unlimited, never exceeded regardless of count', () => {
        const quota = computeBatchQuota({ plan: 'pro_plus', chargeCount: 100_000 });
        expect(quota.max).toBeNull();
        expect(quota.exceeded).toBe(false);
    });

    it('read_only: monthly cap is 0, exceeded as soon as a count loads', () => {
        expect(computeBatchQuota({ plan: 'read_only', chargeCount: 0 }).exceeded).toBe(true);
    });

    it('count not yet loaded → fail-open, never blocks', () => {
        expect(computeBatchQuota({ plan: 'pro' }).exceeded).toBe(false);
        expect(computeBatchQuota({ plan: 'trial' }).exceeded).toBe(false);
        expect(computeBatchQuota({ plan: 'read_only' }).exceeded).toBe(false);
    });
});
