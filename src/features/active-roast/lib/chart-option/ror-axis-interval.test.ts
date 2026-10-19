import { toDisplayRoR } from '@features/active-roast/lib/temperature';
import { describe, expect, it } from 'vitest';
import {
    alignRorAxisBound,
    capRorDisplayInterval,
    countRorTicks,
    ROR_AXIS_MAX_TICKS,
    resolveRorAxisInterval,
} from './ror-axis-interval';

const tickLimit = ROR_AXIS_MAX_TICKS + 1;

describe('ror-axis-interval', () => {
    it('snaps axis bounds to interval multiples', () => {
        expect(alignRorAxisBound(-5, 2, 'min')).toBe(-6);
        expect(alignRorAxisBound(20, 2, 'max')).toBe(20);
        expect(alignRorAxisBound(-5, 3, 'min')).toBe(-6);
        expect(alignRorAxisBound(20, 3, 'max')).toBe(21);
    });

    it('does not add an extra tick from floating-point ratio error', () => {
        const interval = 0.1;
        expect(alignRorAxisBound(0.3, interval, 'max')).toBeCloseTo(0.3, 12);
        expect(countRorTicks(0, 0.3, interval)).toBe(4);
    });

    it('raises the display interval when snapped tick count exceeds the cap', () => {
        const min = -100;
        const max = 300;
        expect(capRorDisplayInterval(min, max, 1).interval).toBe(5);
        expect(capRorDisplayInterval(min, max, 1).capped).toBe(true);
        expect(capRorDisplayInterval(min, max, 5).capped).toBe(false);
    });

    it('caps when snap widens the axis enough to exceed 80 steps (−102..298, interval 5)', () => {
        const { displayInterval, capped } = resolveRorAxisInterval(-102, 298, 5, 'C');
        expect(capped).toBe(true);
        expect(displayInterval).toBeGreaterThan(5);
        expect(countRorTicks(-102, 298, displayInterval)).toBeLessThanOrEqual(tickLimit);
        expect(capRorDisplayInterval(-102, 298, 5).capped).toBe(true);
    });

    it('keeps default-range intervals 1–5 uncapped in °C and °F', () => {
        for (const unit of ['C', 'F'] as const) {
            const min = toDisplayRoR(-5, unit);
            const max = toDisplayRoR(20, unit);
            for (let interval = 1; interval <= 5; interval += 1) {
                const stored = interval;
                const { displayInterval, capped } = resolveRorAxisInterval(min, max, stored, unit);
                expect(capped).toBe(false);
                expect(displayInterval).toBe(toDisplayRoR(stored, unit));
                expect(countRorTicks(min, max, displayInterval)).toBeLessThanOrEqual(tickLimit);
            }
        }
    });

    it('limits −100..300 °C at interval 1 to at most 80 tick steps', () => {
        const min = -100;
        const max = 300;
        const { displayInterval, capped } = resolveRorAxisInterval(min, max, 1, 'C');
        expect(capped).toBe(true);
        expect(countRorTicks(min, max, displayInterval)).toBeLessThanOrEqual(tickLimit);
    });
});
