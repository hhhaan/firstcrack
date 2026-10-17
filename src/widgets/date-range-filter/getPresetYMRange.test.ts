import { getPresetYMRange } from '@widgets/date-range-filter';
import { describe, expect, it, vi } from 'vitest';

describe('getPresetYMRange', () => {
    it('returns the current month for this-month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        const range = getPresetYMRange('this-month');
        vi.useRealTimers();
        expect(range).toEqual({ fromYM: '2025-06', toYM: '2025-06' });
    });

    it('returns the previous month for last-month', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        const range = getPresetYMRange('last-month');
        vi.useRealTimers();
        expect(range).toEqual({ fromYM: '2025-05', toYM: '2025-05' });
    });

    it('returns a rolling 3-month window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        const range = getPresetYMRange('3-months');
        vi.useRealTimers();
        expect(range).toEqual({ fromYM: '2025-04', toYM: '2025-06' });
    });

    it('returns null for all/custom presets', () => {
        expect(getPresetYMRange('all')).toBeNull();
        expect(getPresetYMRange('custom')).toBeNull();
    });
});
