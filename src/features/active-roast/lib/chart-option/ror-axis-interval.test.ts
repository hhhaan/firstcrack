import { toDisplayRoR } from '@features/active-roast/lib/temperature';
import { describe, expect, it } from 'vitest';
import {
    alignRorAxisBound,
    capRorDisplayInterval,
    countRorTicks,
    ROR_AXIS_MAX_TICKS,
    resolveRorAxisInterval,
} from './ror-axis-interval';

describe('ror-axis-interval', () => {
    it('snaps axis bounds to interval multiples', () => {
        expect(alignRorAxisBound(-5, 2, 'min')).toBe(-6);
        expect(alignRorAxisBound(20, 2, 'max')).toBe(20);
        expect(alignRorAxisBound(-5, 3, 'min')).toBe(-6);
        expect(alignRorAxisBound(20, 3, 'max')).toBe(21);
    });

    it('raises the display interval when span exceeds the tick cap', () => {
        const span = toDisplayRoR(300 - -100, 'C');
        expect(capRorDisplayInterval(span, 1).interval).toBe(5);
        expect(capRorDisplayInterval(span, 1).capped).toBe(true);
        expect(capRorDisplayInterval(span, 5).capped).toBe(false);
    });

    it('keeps default-range intervals 1–5 uncapped in °C and °F', () => {
        for (const unit of ['C', 'F'] as const) {
            const min = toDisplayRoR(-5, unit);
            const max = toDisplayRoR(20, unit);
            const span = max - min;
            for (let interval = 1; interval <= 5; interval += 1) {
                const stored = interval;
                const { displayInterval, capped } = resolveRorAxisInterval(min, max, stored, unit);
                expect(capped).toBe(false);
                expect(displayInterval).toBe(toDisplayRoR(stored, unit));
                expect(span / displayInterval).toBeLessThanOrEqual(ROR_AXIS_MAX_TICKS);
            }
        }
    });

    it('limits −100..300 °C at interval 1 to at most 80 tick steps', () => {
        const min = -100;
        const max = 300;
        const { displayInterval, capped } = resolveRorAxisInterval(min, max, 1, 'C');
        expect(capped).toBe(true);
        expect((max - min) / displayInterval).toBeLessThanOrEqual(ROR_AXIS_MAX_TICKS);
        expect(countRorTicks(min, max, displayInterval)).toBeLessThanOrEqual(ROR_AXIS_MAX_TICKS + 1);
    });
});
