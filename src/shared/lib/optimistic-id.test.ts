import { describe, expect, it } from 'vitest';
import { isOptimisticId, persistedId } from './optimistic-id';

describe('optimistic ids', () => {
    it('recognises only the opt_ prefix', () => {
        expect(isOptimisticId('opt_abc')).toBe(true);
        expect(isOptimisticId('11111111-1111-4111-8111-111111111111')).toBe(false);
        expect(isOptimisticId(null)).toBe(false);
        expect(persistedId('opt_abc')).toBeNull();
        expect(persistedId('bean-1')).toBe('bean-1');
    });
});
