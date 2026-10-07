import { describe, expect, it } from 'vitest';
import { layoutControlAxes, resolveControlUnits, stickyControlLimits } from './control-channels';

describe('stickyControlLimits', () => {
    const virtualLimits = {
        drum: { min: 0, max: 100, unit: '%' },
        heater: { min: 0, max: 100, unit: '%' },
        fan: { min: 0, max: 100, unit: '%' },
    };
    const loringLimits = {
        heater: { min: 0, max: 100, unit: '%' },
    };

    it('keeps axis units when limits go empty for the same machine', () => {
        let state = null;
        let resolved = stickyControlLimits(state, 'virtual', virtualLimits);
        state = resolved.state;
        const before = layoutControlAxes(
            { drum: true, heat: true, fan: true },
            resolveControlUnits(resolved.limits),
            0,
            100,
        );
        expect(before.left.unit).toBe('%');

        resolved = stickyControlLimits(state, 'virtual', {});
        const after = layoutControlAxes(
            { drum: true, heat: true, fan: true },
            resolveControlUnits(resolved.limits),
            0,
            100,
            { drum: [49, 50, 51] },
        );
        expect(after.left.unit).toBe('%');
        expect(after.left.min).toBe(0);
        expect(after.left.max).toBe(100);
    });

    it('resets when the machine preset changes', () => {
        let state = null;
        let resolved = stickyControlLimits(state, 'virtual', virtualLimits);
        state = resolved.state;
        resolved = stickyControlLimits(state, 'loring_smart_roast', {});
        const axes = layoutControlAxes(
            { drum: false, heat: true, fan: false },
            resolveControlUnits(resolved.limits),
            0,
            100,
            { heat: [60] },
        );
        expect(resolveControlUnits(resolved.limits).heat.unit).toBe('%');
        expect(axes.right.min).toBe(0);
        expect(axes.right.max).toBe(100);

        resolved = stickyControlLimits(resolved.state, 'loring_smart_roast', loringLimits);
        expect(resolveControlUnits(resolved.limits).heat.unit).toBe('%');
    });
});
