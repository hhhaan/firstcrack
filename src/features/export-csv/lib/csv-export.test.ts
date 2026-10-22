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
    it('exports stored numbers independently of manually edited or unnumbered titles', () => {
        const csv = sessionsToCsv([
            session({ batch_name: 'Morning roast', profile_batch_number: 9, total_batch_number: 13 }),
            session({ batch_name: 'Ethiopia', profile_batch_number: 10, total_batch_number: 14 }),
            session({ batch_name: 'Legacy #99', profile_batch_number: null, total_batch_number: null }),
        ]);
        const lines = csv.trim().split('\n');
        expect(lines[1]).toMatch(/,Morning roast,9,13$/);
        expect(lines[2]).toMatch(/,,10,14$/);
        expect(lines[3]).toMatch(/,Legacy #99,,$/);
    });
    it('exports distinct roast titles without replacing the bean and preserves legacy titles', () => {
        const csv = sessionsToCsv([
            session({ batch_name: 'Batch A', bean_label: 'Legacy title' }),
            session({ batch_name: 'Batch, "B"', bean_label: 'Legacy title' }),
            session({ batch_name: null, bean_label: 'Legacy title' }),
            // Title that only repeats the bean column is noise — the bean already says it.
            session({ batch_name: 'Ethiopia' }),
        ]);
        const lines = csv.trim().split('\n');
        expect(lines[0]).toMatch(/,Roast Title,Profile Batch Number,Total Batch Number$/);
        expect(lines[1]).toContain(',Ethiopia,Yirgacheffe,City+,');
        expect(lines[1]).toMatch(/,Batch A,,$/);
        expect(lines[2]).toMatch(/,"Batch, ""B""",,$/);
        expect(lines[3]).toMatch(/,Legacy title,,$/);
        expect(lines[4]).toMatch(/,Ethiopia,Yirgacheffe,City\+,/);
        expect(lines[4]).toMatch(/,$/);
    });
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
