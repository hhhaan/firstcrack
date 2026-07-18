import { describe, expect, it } from 'vitest';
import {
    buildRRule,
    expandRRule,
    expandRRuleInRange,
    formatDateLocal,
    mergeRecurrenceExceptions,
    parseRruleToInterval,
    previewRecurrenceDates,
} from './rrule';

describe('buildRRule / parseRruleToInterval', () => {
    it('builds FREQ for each interval', () => {
        expect(buildRRule('daily')).toContain('FREQ=DAILY');
        expect(buildRRule('weekly')).toMatch(/FREQ=WEEKLY/);
        expect(buildRRule('weekly')).not.toContain('INTERVAL=2');
        expect(buildRRule('biweekly')).toContain('FREQ=WEEKLY');
        expect(buildRRule('biweekly')).toContain('INTERVAL=2');
        expect(buildRRule('monthly')).toContain('FREQ=MONTHLY');
    });

    it('applies count', () => {
        expect(buildRRule('weekly', { count: 4 })).toContain('COUNT=4');
    });

    it('round-trips parseRruleToInterval', () => {
        expect(parseRruleToInterval(buildRRule('daily'))).toBe('daily');
        expect(parseRruleToInterval(buildRRule('weekly'))).toBe('weekly');
        expect(parseRruleToInterval(buildRRule('biweekly'))).toBe('biweekly');
        expect(parseRruleToInterval(buildRRule('monthly'))).toBe('monthly');
        expect(parseRruleToInterval(null)).toBeNull();
        expect(parseRruleToInterval('FREQ=YEARLY')).toBeNull();
    });
});

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

    it('daily fills consecutive days in range', () => {
        const dtstart = new Date(2026, 6, 1);
        const rangeStart = new Date(2026, 6, 1);
        const rangeEnd = new Date(2026, 6, 3);
        const dates = expandRRuleInRange('FREQ=DAILY', dtstart, rangeStart, rangeEnd).map(formatDateLocal);
        expect(dates).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    });

    it('monthly keeps day-of-month', () => {
        const dtstart = new Date(2026, 0, 15);
        const rangeStart = new Date(2026, 0, 1);
        const rangeEnd = new Date(2026, 3, 30);
        const dates = expandRRuleInRange('FREQ=MONTHLY', dtstart, rangeStart, rangeEnd).map(formatDateLocal);
        expect(dates).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
    });
});

describe('expandRRule / previewRecurrenceDates', () => {
    it('expandRRule with COUNT limits occurrences', () => {
        const dtstart = new Date(2026, 0, 5);
        const dates = expandRRule(buildRRule('weekly', { count: 3 }), dtstart);
        expect(dates).toHaveLength(3);
        expect(dates.map(formatDateLocal)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    });

    it('previewRecurrenceDates returns empty without interval', () => {
        expect(previewRecurrenceDates(null, new Date(2026, 0, 1))).toEqual([]);
    });

    it('previewRecurrenceDates respects limit', () => {
        const dates = previewRecurrenceDates('daily', new Date(2026, 0, 1), 3);
        expect(dates).toHaveLength(3);
        expect(dates.map(formatDateLocal)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    });
});

describe('mergeRecurrenceExceptions', () => {
    const week = [new Date(2026, 6, 6), new Date(2026, 6, 13), new Date(2026, 6, 20)];

    it('drops cancelled originals', () => {
        const instances = mergeRecurrenceExceptions(week, [
            { original_date: '2026-07-13', scheduled_date: '2026-07-13', exception_type: 'cancelled' },
        ]);
        expect(instances.map((i) => i.date)).toEqual(['2026-07-06', '2026-07-20']);
    });

    it('includes moved modified outside expanded range', () => {
        const instances = mergeRecurrenceExceptions(
            [new Date(2026, 6, 6)],
            [
                {
                    original_date: '2026-07-13',
                    scheduled_date: '2026-07-14',
                    exception_type: 'modified',
                    bean_name: 'Moved',
                },
            ],
        );
        const moved = instances.find((i) => i.originalDate === '2026-07-13');
        expect(moved?.date).toBe('2026-07-14');
        expect(moved?.exceptionType).toBe('modified');
        expect(moved?.exception?.bean_name).toBe('Moved');
    });
});
