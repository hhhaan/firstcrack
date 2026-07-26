import { describe, expect, it } from 'vitest';
import { earliestOrderedAt } from './normalize.ts';

describe('earliestOrderedAt (#125 degraded sync poisons ordered_at)', () => {
    const real = '2026-07-20T03:00:00.000Z';
    const fabricatedNow = '2026-07-26T09:00:00.000Z';

    it('takes the incoming value for a brand new order', () => {
        expect(earliestOrderedAt(null, real)).toBe(real);
    });

    it('repairs a fabricated `now` once the real timestamp arrives', () => {
        expect(earliestOrderedAt(fabricatedNow, real)).toBe(real);
    });

    it('cannot be re-poisoned by a later degraded sync', () => {
        expect(earliestOrderedAt(real, fabricatedNow)).toBe(real);
    });

    it('keeps the stored value when the incoming one is unparseable', () => {
        expect(earliestOrderedAt(real, 'garbage')).toBe(real);
    });

    it('replaces an unparseable stored value', () => {
        expect(earliestOrderedAt('garbage', real)).toBe(real);
    });
});
