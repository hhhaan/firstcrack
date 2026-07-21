import { describe, expect, it } from 'vitest';
import type { BeanStockEventInsert, StockSummary } from './api';
import { applyStockEventDelta } from './queries';

const base: StockSummary = {
    currentGrams: 1000,
    availableGrams: 1000,
    reservedGrams: 200,
    effectiveGrams: 800,
};

const event = (partial: Partial<BeanStockEventInsert>): BeanStockEventInsert =>
    ({
        user_id: 'u1',
        bean_id: 'b1',
        delta_grams: -100,
        event_type: 'roast',
        ...partial,
    }) as BeanStockEventInsert;

describe('applyStockEventDelta', () => {
    it('applies roast to current and available', () => {
        const next = applyStockEventDelta(base, event({ delta_grams: -100, event_type: 'roast' }));
        expect(next.currentGrams).toBe(900);
        expect(next.availableGrams).toBe(900);
        expect(next.reservedGrams).toBe(200);
        expect(next.effectiveGrams).toBe(700);
    });

    it('applies purchase to current and available', () => {
        const next = applyStockEventDelta(base, event({ delta_grams: 500, event_type: 'purchase' }));
        expect(next.currentGrams).toBe(1500);
        expect(next.availableGrams).toBe(1500);
        expect(next.effectiveGrams).toBe(1300);
    });
});
