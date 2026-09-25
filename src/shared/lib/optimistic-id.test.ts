import { describe, expect, it, vi } from 'vitest';
import {
    isOptimisticId,
    optimisticReplacementSource,
    optimisticReplacementTarget,
    persistedId,
    publishOptimisticIdReplaced,
    subscribeOptimisticIdReplaced,
} from './optimistic-id';

describe('optimistic ids', () => {
    it('recognises only the opt_ prefix', () => {
        expect(isOptimisticId('opt_abc')).toBe(true);
        expect(isOptimisticId('11111111-1111-4111-8111-111111111111')).toBe(false);
        expect(isOptimisticId(null)).toBe(false);
        expect(persistedId('opt_abc')).toBeNull();
        expect(persistedId('bean-1')).toBe('bean-1');
    });

    it('notifies selection holders and ignores non-optimistic ids', () => {
        const listener = vi.fn();
        const stop = subscribeOptimisticIdReplaced(listener);
        publishOptimisticIdReplaced('opt_temp', 'real-id');
        publishOptimisticIdReplaced('real-id', 'other');
        expect(optimisticReplacementSource('real-id')).toBe('opt_temp');
        expect(optimisticReplacementTarget('opt_temp')).toBe('real-id');
        stop();
        publishOptimisticIdReplaced('opt_temp', 'later');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith('opt_temp', 'real-id');
    });
});
