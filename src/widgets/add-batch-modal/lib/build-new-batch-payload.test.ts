import { describe, expect, it } from 'vitest';
import { buildNewBatchPayload } from './build-new-batch-payload';

describe('buildNewBatchPayload', () => {
    const base = {
        date: new Date(2026, 6, 17),
        machineId: 'm1',
        machineName: 'Roaster A',
        profileId: 'p1',
        profileName: 'City',
        beanId: 'bean-1',
        blendId: 'blend-1',
        beanName: 'Ethiopia',
        targetRoasted: 10,
        batchSize: 12,
        yieldPct: 0.82,
        batchCount: 1,
        greenNeeded: 12.2,
        greenLot: 'lot-a',
        notes: 'note',
        recurringInterval: 'weekly' as const,
    };

    it('single origin: keeps beanId, clears blendId', () => {
        const payload = buildNewBatchPayload({ ...base, batchType: 'Single Origin' });
        expect(payload).toMatchObject({
            beanId: 'bean-1',
            blendId: null,
            targetRoasted: 10,
            batchSize: 12,
            batchCount: 1,
            recurringInterval: 'weekly',
        });
    });

    it('passes keepExistingProfile through so a blank edit does not clear a saved profile', () => {
        const payload = buildNewBatchPayload({
            ...base,
            batchType: 'Single Origin',
            profileId: null,
            keepExistingProfile: true,
        });
        expect(payload.profileId).toBeNull();
        expect(payload.keepExistingProfile).toBe(true);
    });

    it('pre-roast blend: keeps blendId, clears beanId', () => {
        const payload = buildNewBatchPayload({
            ...base,
            batchType: 'Pre-roast Blend',
            beanName: 'House Blend',
        });
        expect(payload.beanId).toBeNull();
        expect(payload.blendId).toBe('blend-1');
        expect(payload.beanName).toBe('House Blend');
    });
});
