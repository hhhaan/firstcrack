import { describe, expect, it } from 'vitest';
import { canGoToNextDashboardMonth, canGoToPreviousDashboardMonth } from './month';

const now = new Date(2026, 9, 25);

describe('dashboard month bounds', () => {
    it('stays on the current month and allows the previous one', () => {
        const month = new Date(2026, 9, 1);
        expect(canGoToPreviousDashboardMonth(month, now)).toBe(true);
        expect(canGoToNextDashboardMonth(month, now)).toBe(false);
    });

    it('stops 24 months before the current month', () => {
        const oldest = new Date(2024, 9, 1);
        const oneAfterOldest = new Date(2024, 10, 1);
        expect(canGoToPreviousDashboardMonth(oldest, now)).toBe(false);
        expect(canGoToPreviousDashboardMonth(oneAfterOldest, now)).toBe(true);
        expect(canGoToNextDashboardMonth(oldest, now)).toBe(true);
    });
});
