import { getPresetYMRange } from '@widgets/date-range-filter';
import { describe, expect, it, vi } from 'vitest';

describe('getPresetYMRange', () => {
    it('returns the current month for this-month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        expect(getPresetYMRange('this-month')).toEqual({ fromYM: '2025-06', toYM: '2025-06' });

        vi.useRealTimers();
    });

    it('returns the previous month for last-month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        expect(getPresetYMRange('last-month')).toEqual({ fromYM: '2025-05', toYM: '2025-05' });

        vi.useRealTimers();
    });

    it('returns a rolling 3-month window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        expect(getPresetYMRange('3-months')).toEqual({ fromYM: '2025-04', toYM: '2025-06' });

        vi.useRealTimers();
    });

    it('returns null for all/custom presets', () => {
        expect(getPresetYMRange('all')).toBeNull();
        expect(getPresetYMRange('custom')).toBeNull();
    });
});
