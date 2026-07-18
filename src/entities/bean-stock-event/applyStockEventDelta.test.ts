import { describe, expect, it } from 'vitest';
import type { BeanStockEventInsert, StockSummary } from './api';
import { applyStockEventDelta } from './queries';

const base: StockSummary = {
    currentGrams: 1000,
    availableGrams: 800,
    reservedGrams: 200,
    effectiveGrams: 600,
};

const event = (partial: Partial<BeanStockEventInsert>): BeanStockEventInsert =>
    ({
        user_id: 'u1',
        bean_id: 'b1',
        delta_grams: -100,
        event_type: 'roast_out',
        ...partial,
    }) as BeanStockEventInsert;

describe('applyStockEventDelta', () => {
    it('applies roast_out to current and available', () => {
        const next = applyStockEventDelta(base, event({ delta_grams: -100, event_type: 'roast_out' }));
        expect(next.currentGrams).toBe(900);
        expect(next.availableGrams).toBe(700);
        expect(next.reservedGrams).toBe(200);
        expect(next.effectiveGrams).toBe(500);
    });

    it('expected_inbound skips currentGrams but updates available', () => {
        const next = applyStockEventDelta(base, event({ delta_grams: 500, event_type: 'expected_inbound' }));
        expect(next.currentGrams).toBe(1000);
        expect(next.availableGrams).toBe(1300);
        expect(next.effectiveGrams).toBe(1100);
    });
});
