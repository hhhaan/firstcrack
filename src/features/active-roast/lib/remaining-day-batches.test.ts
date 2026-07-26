import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { getRemainingDayBatches, shouldOfferNextRoast } from './remaining-day-batches';

const batch = (over: Partial<PlanBatchWithProgress> & { id: string }): PlanBatchWithProgress =>
    ({
        plan_id: 'plan-1',
        bean_id: 'bean-1',
        blend_id: null,
        bean_name: 'Ethiopia',
        batch_size_kg: 5,
        roast_profile_id: null,
        batch_count: 2,
        completed_sessions: 0,
        ...over,
    }) as PlanBatchWithProgress;

describe('getRemainingDayBatches', () => {
    it('returns empty when all complete', () => {
        expect(
            getRemainingDayBatches([
                batch({ id: 'a', completed_sessions: 2, batch_count: 2 }),
                batch({ id: 'b', completed_sessions: 1, batch_count: 1 }),
            ]),
        ).toEqual([]);
    });

    it('keeps only incomplete batches in order', () => {
        const a = batch({ id: 'a', completed_sessions: 2, batch_count: 2 });
        const b = batch({ id: 'b', completed_sessions: 0, batch_count: 2 });
        const c = batch({ id: 'c', completed_sessions: 1, batch_count: 3 });
        expect(getRemainingDayBatches([a, b, c]).map((x) => x.id)).toEqual(['b', 'c']);
    });

    it('moves preferBatchId to front when remaining', () => {
        const a = batch({ id: 'a', completed_sessions: 0 });
        const b = batch({ id: 'b', completed_sessions: 1, batch_count: 3 });
        expect(getRemainingDayBatches([a, b], { preferBatchId: 'b' }).map((x) => x.id)).toEqual(['b', 'a']);
    });

    it('ignores preferBatchId when that batch is fully done', () => {
        const a = batch({ id: 'a', completed_sessions: 2, batch_count: 2 });
        const b = batch({ id: 'b', completed_sessions: 0 });
        expect(getRemainingDayBatches([a, b], { preferBatchId: 'a' }).map((x) => x.id)).toEqual(['b']);
    });
});

describe('shouldOfferNextRoast', () => {
    it('true when remaining non-empty', () => {
        expect(shouldOfferNextRoast([batch({ id: 'a' })])).toBe(true);
    });

    it('false when empty', () => {
        expect(shouldOfferNextRoast([])).toBe(false);
    });
});
