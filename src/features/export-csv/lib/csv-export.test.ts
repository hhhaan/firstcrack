import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { describe, expect, it } from 'vitest';
import { sessionsToCsv } from './csv-export';

const session = (partial: Partial<RoastSessionWithRelations> = {}): RoastSessionWithRelations =>
    ({
        id: 's1',
        user_id: 'u1',
        roasted_at: '2026-07-01T10:00:00Z',
        weight_grams: 820,
        roast_level: 'Medium',
        drop_temp_celsius: 205,
        duration_seconds: 600,
        notes: 'clean',
        beans: { name: 'Ethiopia', origin: 'Yirgacheffe' },
        roast_profiles: { name: 'City+' },
        ...partial,
    }) as RoastSessionWithRelations;

describe('sessionsToCsv', () => {
    it('prefixes UTF-8 BOM and header row', () => {
        const csv = sessionsToCsv([session()]);
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv).toContain('Date,Bean,Origin,Profile');
        expect(csv).toContain('2026-07-01');
        expect(csv).toContain('Ethiopia');
        expect(csv).toContain('Yirgacheffe');
        expect(csv).toContain('City+');
        expect(csv).toContain('10:00'); // duration 600s
    });

    it('exports Drop-first roast duration, not End-elapsed duration_seconds', () => {
        const csv = sessionsToCsv([
            session({
                duration_seconds: 660,
                events: [
                    { id: 'fc', type: 'FC Start', time_sec: 480 },
                    { id: 'drop', type: 'Drop', time_sec: 600 },
                    { id: 'end', type: 'End', time_sec: 660 },
                ],
            }),
        ]);
        expect(csv).toContain('10:00');
        expect(csv).not.toContain('11:00');
    });

    it('exports End-based duration when Drop is missing', () => {
        const csv = sessionsToCsv([
            session({
                duration_seconds: 660,
                events: [
                    { id: 'fc', type: 'FC Start', time_sec: 480 },
                    { id: 'end', type: 'End', time_sec: 660 },
                ],
            }),
        ]);
        expect(csv).toContain('11:00');
    });

    it('marks loss rate as measured only when output weight was captured', () => {
        const estimated = sessionsToCsv([session({ weight_grams: 10000 })])
            .trim()
            .split('\n')[1];
        expect(estimated).toContain('estimated');
        expect(estimated).toContain('15'); // level-based estimate (fixture is Medium)

        const measured = sessionsToCsv([session({ weight_grams: 10000, output_weight_grams: 8400 })])
            .trim()
            .split('\n')[1];
        expect(measured).toContain('measured');
        expect(measured).toContain('16');
    });

    it('escapes commas quotes and newlines in notes', () => {
        const csv = sessionsToCsv([session({ notes: 'said "hello", then\nline2' })]);
        expect(csv).toContain('"said ""hello"", then\nline2"');
    });

    it('handles null optional fields without throwing', () => {
        const csv = sessionsToCsv([
            session({
                roasted_at: null,
                beans: null,
                roast_profiles: null,
                drop_temp_celsius: null,
                duration_seconds: null,
                notes: null,
            }),
        ]);
        expect(csv).toContain('\uFEFF');
        const dataLine = csv.trim().split('\n')[1];
        expect(dataLine.split(',').length).toBeGreaterThanOrEqual(10);
    });
});
