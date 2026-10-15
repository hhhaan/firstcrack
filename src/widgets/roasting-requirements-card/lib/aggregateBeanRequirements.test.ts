import { describe, expect, it } from 'vitest';
import { aggregateBeanRequirements, type BeanRequirementRow } from './aggregateBeanRequirements';

const row = (
    partial: Partial<BeanRequirementRow> &
        Pick<BeanRequirementRow, 'bean_id' | 'green_grams_needed' | 'green_available'>,
): BeanRequirementRow => ({
    roast_profile_id: partial.roast_profile_id ?? 'profile-a',
    roasted_grams_needed: partial.roasted_grams_needed ?? 0,
    ...partial,
});

describe('aggregateBeanRequirements', () => {
    it('sums two profiles for one bean and marks short when total exceeds available', () => {
        const result = aggregateBeanRequirements([
            row({ bean_id: 'bean-1', roast_profile_id: 'p1', green_grams_needed: 4000, green_available: 5000 }),
            row({ bean_id: 'bean-1', roast_profile_id: 'p2', green_grams_needed: 4000, green_available: 5000 }),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].green_grams_needed).toBe(8000);
        expect(result[0].green_available).toBe(5000);
        expect(result[0].profiles).toHaveLength(2);
        expect(result[0].green_grams_needed > result[0].green_available).toBe(true);
    });

    it('does not mark short when a single profile is below available', () => {
        const result = aggregateBeanRequirements([
            row({ bean_id: 'bean-1', green_grams_needed: 4000, green_available: 5000 }),
        ]);
        expect(result[0].green_grams_needed).toBe(4000);
        expect(result[0].green_grams_needed > result[0].green_available).toBe(false);
    });

    it('does not mark short when needed equals available', () => {
        const result = aggregateBeanRequirements([
            row({ bean_id: 'bean-1', green_grams_needed: 5000, green_available: 5000 }),
        ]);
        expect(result[0].green_grams_needed > result[0].green_available).toBe(false);
    });

    it('keeps different beans separate', () => {
        const result = aggregateBeanRequirements([
            row({ bean_id: 'bean-1', green_grams_needed: 1000, green_available: 5000 }),
            row({ bean_id: 'bean-2', green_grams_needed: 2000, green_available: 5000 }),
        ]);
        expect(result.map((r) => r.bean_id)).toEqual(['bean-1', 'bean-2']);
    });

    it('drops zero-need rows', () => {
        expect(
            aggregateBeanRequirements([row({ bean_id: 'bean-1', green_grams_needed: 0, green_available: 5000 })]),
        ).toEqual([]);
    });

    it('preserves per-profile amounts in order', () => {
        const result = aggregateBeanRequirements([
            row({ bean_id: 'bean-1', roast_profile_id: 'p1', green_grams_needed: 1000, green_available: 5000 }),
            row({ bean_id: 'bean-1', roast_profile_id: 'p2', green_grams_needed: 2000, green_available: 5000 }),
        ]);
        expect(result[0].profiles).toEqual([
            { roast_profile_id: 'p1', green_grams_needed: 1000 },
            { roast_profile_id: 'p2', green_grams_needed: 2000 },
        ]);
    });
});
