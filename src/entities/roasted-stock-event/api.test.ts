import { describe, expect, it } from 'vitest';
import { mapRoastedStockRecord } from './api';

describe('mapRoastedStockRecord', () => {
    it('maps rpc jsonb to typed summaries', () => {
        const raw = {
            'bean:b1': { grams: 8400, has_estimate: false },
            'blend:x1': { grams: 2000, has_estimate: true },
        };
        expect(mapRoastedStockRecord(raw)).toEqual({
            'bean:b1': { grams: 8400, hasEstimate: false },
            'blend:x1': { grams: 2000, hasEstimate: true },
        });
    });

    it('handles null/malformed input', () => {
        expect(mapRoastedStockRecord(null)).toEqual({});
        expect(mapRoastedStockRecord({ 'bean:b1': {} })).toEqual({ 'bean:b1': { grams: 0, hasEstimate: false } });
    });
});
