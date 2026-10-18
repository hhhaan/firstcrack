import { describe, expect, it } from 'vitest';
import { formatCostPerKgForHash, stockEventContentKey } from './stockEventContentKey';

describe('formatCostPerKgForHash', () => {
    it('keeps whole-number costs intact', () => {
        expect(formatCostPerKgForHash(10000)).toBe('10000');
        expect(formatCostPerKgForHash(1500)).toBe('1500');
    });

    it('normalizes fractional trailing zeros', () => {
        expect(formatCostPerKgForHash(10000.0)).toBe('10000');
        expect(formatCostPerKgForHash(12.5)).toBe('12.5');
        expect(formatCostPerKgForHash(0.5)).toBe('0.5');
    });
});

describe('stockEventContentKey', () => {
    const base = {
        user_id: 'u1',
        bean_id: 'b1',
        delta_grams: 1000,
        event_type: 'purchase' as const,
    };

    it('embeds formatted cost', () => {
        expect(stockEventContentKey({ ...base, cost_per_kg: 12000 })).toBe('u1|b1|1000|purchase|12000');
        expect(stockEventContentKey({ ...base, cost_per_kg: 12.5 })).toBe('u1|b1|1000|purchase|12.5');
    });
});
