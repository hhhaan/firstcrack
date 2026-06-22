import { describe, expect, it } from 'vitest';
import { batchGreenNeededGrams, calcPlanBatchCount, parseStockSummaryJson, STOCK_HORIZON_DAYS } from './stock-calc';

describe('calcPlanBatchCount', () => {
    it('uses stored batch_count when provided', () => {
        expect(calcPlanBatchCount(10, 5, 0.82, 3)).toBe(3);
    });

    it('applies yield when deriving count', () => {
        expect(calcPlanBatchCount(10, 5, 0.5)).toBe(4);
        expect(calcPlanBatchCount(10, 5, 1)).toBe(2);
    });
});

describe('batchGreenNeededGrams', () => {
    it('scales by blend ratio', () => {
        expect(batchGreenNeededGrams(2, 0, 5, 60)).toBe(6000);
    });
});

describe('parseStockSummaryJson', () => {
    it('maps snake_case rpc payload', () => {
        expect(
            parseStockSummaryJson({
                current_grams: 1000,
                available_grams: 1500,
                reserved_grams: 500,
                effective_grams: 1000,
            }),
        ).toEqual({
            currentGrams: 1000,
            availableGrams: 1500,
            reservedGrams: 500,
            effectiveGrams: 1000,
        });
    });
});

describe('STOCK_HORIZON_DAYS', () => {
    it('defaults to 28', () => {
        expect(STOCK_HORIZON_DAYS).toBe(28);
    });
});
