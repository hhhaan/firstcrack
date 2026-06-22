import { describe, expect, it } from 'vitest';
import { expandRRuleInRange, formatDateLocal } from './rrule';

describe('expandRRuleInRange dtstart anchor', () => {
    it('weekly occurrences fall on the same weekday as dtstart', () => {
        const dtstart = new Date('2026-01-05T00:00:00');
        const rangeStart = new Date('2026-06-01T00:00:00');
        const rangeEnd = new Date('2026-06-30T23:59:59');

        const dates = expandRRuleInRange('FREQ=WEEKLY', dtstart, rangeStart, rangeEnd);

        expect(dates.length).toBeGreaterThan(0);
        for (const d of dates) {
            expect(d.getDay()).toBe(dtstart.getDay());
        }
        expect(dates.map(formatDateLocal)).toContain('2026-06-01');
    });

    it('biweekly skips alternate weeks', () => {
        const dtstart = new Date('2026-01-05T00:00:00');
        const rangeStart = new Date('2026-06-01T00:00:00');
        const rangeEnd = new Date('2026-06-30T23:59:59');

        const dates = expandRRuleInRange('FREQ=WEEKLY;INTERVAL=2', dtstart, rangeStart, rangeEnd).map(formatDateLocal);

        expect(dates).toContain('2026-06-08');
        expect(dates).toContain('2026-06-22');
        expect(dates).not.toContain('2026-06-01');
        expect(dates).not.toContain('2026-06-15');
    });
});
