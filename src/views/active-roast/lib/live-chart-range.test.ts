import { describe, expect, it } from 'vitest';
import { growLiveChartExtent } from './live-chart-range';

const input = { key: 'a', origin: 0, minimumRight: 900, latest: 500, span: 900 };

describe('automatic live time range', () => {
    it('leaves headroom and grows by whole minutes before the curve reaches the right edge', () => {
        const initial = growLiveChartExtent(null, input);
        expect(initial.right).toBe(900);
        const grown = growLiveChartExtent(initial, { ...input, latest: 850 });
        expect(grown.right).toBe(960);
        expect(grown.right - 850).toBeGreaterThanOrEqual(90);
        expect(growLiveChartExtent(grown, { ...input, latest: 950 }).right).toBe(1080);
    });
    it('provides at least a minute even with a short configured range', () => {
        expect(growLiveChartExtent(null, { ...input, minimumRight: 60, span: 60, latest: 55 }).right).toBe(120);
    });
    it('does not shrink the same timeline, including across Charge origin changes', () => {
        const initial = growLiveChartExtent(null, input);
        const charged = growLiveChartExtent(initial, { ...input, origin: 500, latest: 0, minimumRight: 780 });
        expect(charged).toBe(initial);
        expect(charged.right - 500).toBe(400);
    });
    it('starts the next batch with its own range', () => {
        const previous = growLiveChartExtent(null, { ...input, latest: 4000 });
        expect(growLiveChartExtent(previous, { ...input, key: 'b', latest: 0 }).right).toBe(900);
    });
});
