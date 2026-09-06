import { describe, expect, it } from 'vitest';
import { monthEndExclusiveIso, monthStartIso } from './api';

describe('monthStartIso / monthEndExclusiveIso', () => {
    it('emits an ISO datetime, not a date-only string that Postgres would parse as UTC midnight', () => {
        expect(monthStartIso('2026-09')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(monthEndExclusiveIso('2026-09')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('is local midnight of the first of the month / the next month', () => {
        const start = new Date(monthStartIso('2026-09'));
        expect(start.getFullYear()).toBe(2026);
        expect(start.getMonth()).toBe(8);
        expect(start.getDate()).toBe(1);
        expect(start.getHours()).toBe(0);
        expect(start.getMinutes()).toBe(0);

        const end = new Date(monthEndExclusiveIso('2026-09'));
        expect(end.getFullYear()).toBe(2026);
        expect(end.getMonth()).toBe(9);
        expect(end.getDate()).toBe(1);
        expect(end.getHours()).toBe(0);
    });
});
