import { describe, expect, it } from 'vitest';
import { formatLookbackLabel } from './useSidecarPolling';

describe('formatLookbackLabel', () => {
    it('prefixes minus only for negative relative seconds', () => {
        expect(formatLookbackLabel(-5)).toBe('-0:05');
        expect(formatLookbackLabel(-65)).toBe('-1:05');
    });

    it('uses unsigned form for zero and positive (lookback-shifted) samples', () => {
        expect(formatLookbackLabel(0)).toBe('0:00');
        expect(formatLookbackLabel(5)).toBe('0:05');
        expect(formatLookbackLabel(125)).toBe('2:05');
    });
});
