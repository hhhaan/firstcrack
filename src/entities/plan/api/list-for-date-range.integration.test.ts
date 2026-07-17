import { expandRRuleInRange, formatDateLocal, mergeRecurrenceExceptions } from '@shared/lib/rrule';
import { describe, expect, it } from 'vitest';

/**
 * Combination: weekly recurrence + cancelled exception day → batch dates for a window.
 * Mirrors listForDateRange merge step without network (pure rrule → instance rows).
 */
describe('schedule recurrence → batch dates (composition)', () => {
    it('weekly rule with cancelled exception omits that day in range', () => {
        const dtstart = new Date(2026, 6, 6); // Mon 2026-07-06
        const rangeStart = new Date(2026, 6, 6);
        const rangeEnd = new Date(2026, 6, 27); // 3 weeks

        const expanded = expandRRuleInRange('FREQ=WEEKLY', dtstart, rangeStart, rangeEnd);
        const dates = expanded.map(formatDateLocal);
        expect(dates).toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']);

        const instances = mergeRecurrenceExceptions(expanded, [
            {
                original_date: '2026-07-13',
                scheduled_date: '2026-07-13',
                exception_type: 'cancelled',
            },
        ]);

        expect(instances.map((i) => i.date)).toEqual(['2026-07-06', '2026-07-20', '2026-07-27']);
        expect(instances.every((i) => i.exceptionType === 'normal')).toBe(true);
    });

    it('modified exception overrides instance and keeps normal siblings', () => {
        const dtstart = new Date(2026, 6, 6);
        const rangeStart = new Date(2026, 6, 6);
        const rangeEnd = new Date(2026, 6, 20);
        const expanded = expandRRuleInRange('FREQ=WEEKLY', dtstart, rangeStart, rangeEnd);

        const instances = mergeRecurrenceExceptions(expanded, [
            {
                original_date: '2026-07-13',
                scheduled_date: '2026-07-13',
                exception_type: 'modified',
                bean_name: 'Override Bean',
                batch_size_kg: 12,
            },
        ]);

        const modified = instances.find((i) => i.originalDate === '2026-07-13');
        expect(modified?.exceptionType).toBe('modified');
        expect(modified?.exception?.bean_name).toBe('Override Bean');
        expect(instances.filter((i) => i.exceptionType === 'normal')).toHaveLength(2);
    });
});
