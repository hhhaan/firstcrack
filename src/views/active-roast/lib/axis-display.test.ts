import { describe, expect, it } from 'vitest';
import { resolveTemperatureBand } from './axis-display';

describe('temperature presentation bounds', () => {
    const input = {
        configured: { tempMinC: 130, tempMaxC: 240 },
        waitingBand: null,
        points: [{ bt: 20, et: 280 }],
        reference: [{ bt: 200, et: 320 }],
    };
    it('fixed mode keeps configured bounds despite out-of-range live/reference measurements', () => {
        expect(resolveTemperatureBand({ ...input, autoExpand: false })).toEqual(input.configured);
    });
    it('automatic mode includes live/reference values and ignores missing or invalid channels', () => {
        expect(
            resolveTemperatureBand({
                ...input,
                autoExpand: true,
                points: [...input.points, { bt: null, et: Number.NaN }],
            }),
        ).toEqual({ tempMinC: 10, tempMaxC: 330 });
    });
    it('keeps the existing charge-wait band when there are no samples', () => {
        const band = { tempMinC: 0, tempMaxC: 300 };
        expect(
            resolveTemperatureBand({ ...input, points: [], reference: [], waitingBand: band, autoExpand: true }),
        ).toEqual(band);
    });
});
