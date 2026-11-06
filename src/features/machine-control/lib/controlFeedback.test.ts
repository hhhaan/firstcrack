import { describe, expect, it } from 'vitest';
import { controlFeedback } from './controlFeedback';

describe('pressure control feedback', () => {
    const reading = { heater: 40, fan: 90, drum: 50 };
    it('does not treat motor percent or an unlabelled legacy value as Pa', () => {
        for (const unit of [undefined, '%']) {
            expect(controlFeedback(reading, 'Pa', unit)).toEqual({ ...reading, fan: null });
        }
    });
    it('uses pressure readings and preserves ordinary percent controls', () => {
        expect(controlFeedback(reading, 'Pa', 'Pa')).toBe(reading);
        expect(controlFeedback(reading, '%', undefined)).toBe(reading);
        expect(controlFeedback(null, 'Pa', undefined)).toBeNull();
    });
});
